"""The import and synchronisation engine. Works on a SourceTable, so the same code serves the
Excel import today and a Google Sheets reader later.

Order of work for one run:
 1. validate the sheet on its own (validate.py)
 2. check each student's rows against the database (identity, Passport ID, first-issue date)
 3. record every source row; turn new valid confirmed rows into skill awards (never edited later)
 4. create missing passports only from official values in the sheet (never invented)
 5. generate a new candidate version for each passport whose awards grew; nothing else changes
 6. issue waiting candidates whose issuance steps succeed (see issue.py); the rest keep waiting
 7. work out each row's Q–T values from what really happened
"""
from __future__ import annotations

import hashlib
import json
import re
import sqlite3
from collections import defaultdict
from dataclasses import dataclass, field

from . import config
from .db import audit, transaction, utc_now
from . import chain
from .issue import (chain_ref, generate_candidate, issue_candidate, record_registration_failure, record_submitted_tx,
                    waiting_candidate)
from .subjects.badges import badge_keys, contained_badges, current_badges
from .table import PASSPORT_ID, FIRST_ISSUED, SYNC_NOTES, SYNC_STATUS, SYNCED_AT, SYNCED_VERSION, SourceTable
from .validate import Record, Validation, validate_table

SYNCED, PENDING_CHAIN, NOT_SYNCED, FAILED = "SYNCED", "PENDING BLOCKCHAIN", "NOT SYNCED", "FAILED"


@dataclass
class Options:
    assign_new_passport_ids: bool = False  # allocate BTU-AI-NNNNNN for new students with none in the sheet
    renderer: object = None                # injectable for tests (e.g. a renderer that fails)
    registrar: object = "configured"       # chain.configured_registrar() unless a test passes its own
    apply_edits: bool = False              # DEMO: apply edits to accepted rows and profiles, then issue a new version


@dataclass
class RunResult:
    run_id: int
    validation: Validation
    summary: dict
    row_status: dict[int, dict[str, object]]      # sheet_row -> Q–T values to write
    preserved: list[dict] = field(default_factory=list)
    new_cells: dict[tuple[int, str], object] = field(default_factory=dict)


def run_import(conn: sqlite3.Connection, table: SourceTable, options: Options | None = None) -> RunResult:
    options = options or Options()
    run_id = conn.execute(
        """INSERT INTO import_runs (source_type, source_name, source_sha256, sheet_name, header_row, started_at, status)
           VALUES (?, ?, ?, ?, ?, ?, 'RUNNING')""",
        (table.source_type, table.source_name, table.source_sha256, table.sheet_name, table.header_row, utc_now()),
    ).lastrowid
    try:
        result = _run(conn, table, options, run_id)
        conn.execute("UPDATE import_runs SET status = 'COMPLETED', finished_at = ?, summary_json = ? WHERE id = ?",
                     (utc_now(), json.dumps(result.summary), run_id))
        s = result.summary
        audit(conn, "IMPORT_COMPLETED", run_id=run_id, source=table.source_name, rows_valid=s["rows_valid"],
              rows_held=s["rows_held"], rows_invalid=s["rows_invalid"], awards_new=s["awards_new"],
              versions_generated=s["versions_generated"], generation_failures=s["generation_failures"],
              issuance_failures=s["issuance_failures"])
        return result
    except BaseException as exc:
        conn.execute("UPDATE import_runs SET status = 'FAILED', finished_at = ?, summary_json = ? WHERE id = ?",
                     (utc_now(), json.dumps({"error": repr(exc)}), run_id))
        audit(conn, "IMPORT_FAILED", run_id=run_id, source=table.source_name, error=repr(exc)[:300])
        raise


def _run(conn, table, options, run_id) -> RunResult:
    v = validate_table(table)
    live = lambda: [r for row, r in sorted(v.records.items()) if row not in v.rejected]
    by_student: dict[str, list[Record]] = defaultdict(list)
    for r in live():
        by_student[r.student_code].append(r)

    # ---- 2. database consistency per student --------------------------------------------------
    for sid, recs in by_student.items():
        problems = _db_identity_problems(conn, recs[0], allow_profile_edits=options.apply_edits)
        if problems:
            v.reject_all([r.row.sheet_row for r in recs], "DATABASE_CONFLICT",
                         f"{sid} doesn't match the system's records: " + "; ".join(problems) +
                         ". Nothing for this student was changed.")

    # ---- 3. source records and awards ---------------------------------------------------------
    counts = defaultdict(int)
    new_awards_by_student = defaultdict(list)
    edited = _EditSet()  # student_fks whose accepted data changed (only with options.apply_edits)
    with transaction(conn):
        for r in live():
            student_fk = _ensure_student(conn, r, counts, edited if options.apply_edits else None)
            _ensure_skill(conn, r, run_id, v)
            if r.row.sheet_row in v.rejected:
                continue
            existing = conn.execute("SELECT * FROM source_records WHERE record_id = ?", (r.record_id,)).fetchone()
            award = conn.execute("SELECT * FROM skill_awards WHERE record_id = ?", (r.record_id,)).fetchone()
            if award:
                if award["student_fk"] != student_fk:
                    v.add(r.row, "ERROR", "RECORD_OWNER_CHANGED",
                          f"{r.record_id} was accepted for another student; the row now names {r.student_code}. Not applied.")
                elif award["source_fingerprint"] != r.fingerprint and options.apply_edits:
                    # Accepted skills stay as issued (a database rule); profile edits on this row are applied
                    # by _ensure_student. Only warn when the skill itself was edited.
                    if any(award[c] != new for c, new in (
                            ("skill_name", r.skill_name), ("skill_category", r.skill_category),
                            ("description", r.description), ("date_earned", r.date_earned.isoformat()))):
                        v.add(r.row, "WARNING", "CHANGED_AFTER_ACCEPT",
                              "The skill on this row was edited after it was issued; issued skills are not rewritten. "
                              "Add the corrected skill as a new row instead.")
                    counts["unchanged"] += 1
                elif award["source_fingerprint"] != r.fingerprint:
                    v.add(r.row, "WARNING", "CHANGED_AFTER_ACCEPT",
                          "Row was edited after this skill was accepted. The accepted skill is kept unchanged; "
                          "corrections to issued skills need an explicit BTU decision.")
                    counts["changed_after_accept"] += 1
                else:
                    counts["unchanged"] += 1
                _upsert_source(conn, r, "ACCEPTED", run_id, existing)
                continue
            if r.row.sheet_row in v.held:
                _upsert_source(conn, r, "HELD", run_id, existing)
                continue
            dup = conn.execute("SELECT record_id FROM skill_awards WHERE student_fk = ? AND skill_id = ?",
                               (student_fk, r.skill_id)).fetchone()
            if dup:
                v.add(r.row, "ERROR", "DUPLICATE_SKILL",
                      f"{r.student_code} already holds {r.skill_id} ({r.skill_name}) from {dup['record_id']}; not added twice")
                _upsert_source(conn, r, "INVALID", run_id, existing)
                continue
            _upsert_source(conn, r, "ACCEPTED", run_id, existing)
            conn.execute(
                """INSERT INTO skill_awards (record_id, student_fk, skill_id, skill_name, skill_category, badge_code,
                       description, date_earned, source_fingerprint, accepted_run, accepted_at)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                (r.record_id, student_fk, r.skill_id, r.skill_name, r.skill_category, r.badge_code, r.description,
                 r.date_earned.isoformat(), r.fingerprint, run_id, utc_now()))
            new_awards_by_student[r.student_code].append(r.record_id)
            counts["accepted_new"] += 1

        # rows refused this run: keep a traceable source record when the Record ID is usable
        for row_no in sorted(v.rejected):
            r = v.records.get(row_no)
            if r and not conn.execute("SELECT 1 FROM skill_awards WHERE record_id = ?", (r.record_id,)).fetchone():
                dup_id = sum(1 for x in v.records.values() if x.record_id == r.record_id) > 1
                if not dup_id:
                    _upsert_source(conn, r, "INVALID", run_id,
                                   conn.execute("SELECT * FROM source_records WHERE record_id = ?", (r.record_id,)).fetchone())

    # ---- 4. passports --------------------------------------------------------------------------
    new_cells = {}
    for sid, recs in by_student.items():
        if all(r.row.sheet_row in v.rejected for r in recs):
            continue
        student = conn.execute("SELECT * FROM students WHERE student_id = ?", (sid,)).fetchone()
        if conn.execute("SELECT 1 FROM passports WHERE student_fk = ?", (student["id"],)).fetchone():
            continue
        has_awards = conn.execute("SELECT 1 FROM skill_awards WHERE student_fk = ?", (student["id"],)).fetchone()
        if not has_awards:
            continue
        pid, first_issued = recs[0].passport_id, recs[0].first_issued
        if pid and first_issued:
            _create_passport(conn, student, pid, first_issued.isoformat())
            counts["passports_created"] += 1
        elif options.assign_new_passport_ids and not pid:
            pid, first_issued = _next_passport_id(conn), utc_now()[:10]
            _create_passport(conn, student, pid, first_issued)
            counts["passports_created"] += 1
            for r in recs:
                v.add(r.row, "WARNING", "PASSPORT_ID_ASSIGNED", f"New Passport ID {pid} assigned, first issued {first_issued}")
                new_cells[(r.row.sheet_row, PASSPORT_ID)] = pid
                new_cells[(r.row.sheet_row, FIRST_ISSUED)] = first_issued
        else:
            missing = [n for n, x in [("Passport ID (Existing)", pid), ("First Issued (Existing)", first_issued)] if not x]
            for r in recs:
                if r.row.sheet_row not in v.rejected:
                    v.add(r.row, "HOLD", "PASSPORT_PENDING",
                          f"Passport pending: {' and '.join(missing)} empty. No official value is invented; "
                          "fill it in the sheet or run with --assign-new-passport-ids.")

    # ---- 5. versions ---------------------------------------------------------------------------
    failures = {}
    # A new version always holds every accepted award, with apply-edits too: a row that was edited, deleted or
    # left out of the sheet never removes a skill that was already awarded (there is no revocation workflow).
    for passport in conn.execute("SELECT * FROM passports ORDER BY passport_id").fetchall():
        outcome = generate_if_needed(conn, passport, options.renderer, run_id, force=passport["student_fk"] in edited)
        if outcome == "generated":
            counts["versions_generated"] += 1
        elif outcome is not None:
            failures[passport["id"]] = outcome
            counts["generation_failures"] += 1

    # ---- 6. issuance ----------------------------------------------------------------------------
    registrar = chain.configured_registrar() if options.registrar == "configured" else options.registrar
    for c in conn.execute("SELECT * FROM version_candidates WHERE state = 'AWAITING_REGISTRATION' ORDER BY id").fetchall():
        counts[{"registered": "issued_registered", "demo": "issued_unregistered", "waiting": "awaiting_registration",
                "failed": "issuance_failures"}[try_issue(conn, c, registrar)]] += 1

    integrity = _check_stored_pdfs(conn)

    # ---- 7. Q–T values and issue log -----------------------------------------------------------
    row_status, preserved = _sheet_status(conn, table, v, failures, run_id)
    with transaction(conn):
        conn.executemany(
            "INSERT INTO row_issues (run_fk, sheet_row, record_id, student_code, severity, code, message) VALUES (?, ?, ?, ?, ?, ?, ?)",
            [(run_id, i.sheet_row, i.record_id, i.student_code, i.severity, i.code, i.message) for i in v.issues])

    rows_by_state = defaultdict(int)
    for row in table.rows:
        n = row.sheet_row
        rows_by_state["invalid" if n in v.rejected else "held" if n in v.held else "valid"] += 1
    valid_students = {r.student_code for r in live() if r.row.sheet_row not in v.held}
    summary = {
        "run_id": run_id,
        "sheet": table.sheet_name,
        "header_row": table.header_row,
        "data_rows": len(table.rows),
        "ignored_note_rows": len(table.ignored_rows),
        "blank_rows": table.blank_rows,
        "rows_valid": rows_by_state["valid"],
        "rows_held": rows_by_state["held"],
        "rows_invalid": rows_by_state["invalid"],
        "students_in_sheet": len({(r.values.get('Student ID') or '') for r in table.rows}),
        "students_with_valid_rows": len(valid_students),
        "awards_new": counts["accepted_new"],
        "awards_unchanged": counts["unchanged"],
        "awards_changed_after_accept": counts["changed_after_accept"],
        "students_created": counts["students_created"],
        "passports_created": counts["passports_created"],
        "versions_generated": counts["versions_generated"],
        "generation_failures": counts["generation_failures"],
        "issuance_mode": config.ISSUANCE_MODE,
        "issued_registered": counts["issued_registered"],
        "issued_unregistered_demo": counts["issued_unregistered"],
        "awaiting_registration": counts["awaiting_registration"],
        "issuance_failures": counts["issuance_failures"],
        "preserved_existing_synced": len(preserved),
        "stored_pdf_problems": integrity,
        "notes": v.run_notes,
    }
    return RunResult(run_id, v, summary, row_status, preserved, new_cells)


# ---------------------------------------------------------------------------------------------

class _EditSet(set):
    """Students edited in this run; .seen holds those whose profile row was already applied."""


def generate_if_needed(conn, passport, renderer=None, run_id: int | None = None, force: bool = False):
    """Generates a candidate if the passport's accepted awards grew past its newest version, or its
    subject badges differ from the newest version's.
    Returns None (nothing new), "generated", or (new record ids, error) on failure, in which case the
    previous version stays current. Only accepted skill_awards are used, and every one of them is kept:
    the new version is a superset of the newest one, never smaller."""
    awarded = {a[0] for a in conn.execute("SELECT record_id FROM skill_awards WHERE student_fk = ?",
                                          (passport["student_fk"],))}
    # compare with the newest version already made: a waiting candidate, else the current version
    waiting = waiting_candidate(conn, passport["id"])
    current = conn.execute("SELECT * FROM passport_versions WHERE passport_fk = ? AND status = 'CURRENT'",
                           (passport["id"],)).fetchone()
    if waiting:
        contained = {a[0] for a in conn.execute("SELECT record_id FROM candidate_records WHERE candidate_fk = ?",
                                                (waiting["id"],))}
    else:
        contained = {a[0] for a in conn.execute("SELECT record_id FROM version_source_records WHERE version_fk = ?",
                                                (current["id"],))} if current else set()
    new = awarded - contained
    target = contained | new
    # subject badges (stage 05): a version follows the student's current badges, so a new, changed or
    # corrected-away badge makes the next version; sheet skills are still never dropped
    badges = current_badges(conn, passport["student_fk"])
    badges_changed = badge_keys(badges) != contained_badges(conn, passport["id"], waiting, current)
    if not new and not badges_changed and not (force and contained):  # force: same skills, edited data -> next version
        return None
    try:
        generate_candidate(conn, passport["id"], sorted(target), renderer, subjects=badges)
        return "generated"
    except Exception as exc:  # the previous version stays current
        if run_id is not None:
            conn.execute(
                "INSERT INTO generation_failures (run_fk, passport_fk, record_ids_json, error, created_at) VALUES (?, ?, ?, ?, ?)",
                (run_id, passport["id"], json.dumps(sorted(new)), str(exc), utc_now()))
        audit(conn, "GENERATION_FAILED", passport["id"], new_records=sorted(new), error=str(exc)[:300])
        return (sorted(new), str(exc))


def try_issue(conn, c, registrar) -> str:
    """Issues one waiting candidate if its issuance steps succeed: "registered", "demo", "waiting"
    (no registrar configured) or "failed" (the error is recorded; the previous version stays current)."""
    try:
        if config.ISSUANCE_MODE == "local-demo":
            issue_candidate(conn, c["id"], unregistered_demo=True)
            return "demo"
        if registrar is None:
            return "waiting"
        data = (config.STORAGE_DIR / c["pdf_storage_key"]).read_bytes()  # the exact stored bytes
        reg = registrar.register(c, chain_ref(conn, c["passport_fk"]), data,
                                 on_submitted=lambda h, cid=c["id"]: record_submitted_tx(conn, cid, h))
        issue_candidate(conn, c["id"], reg)
        return "registered"
    except Exception as exc:  # registration or issuance failed: the previous version stays current
        record_registration_failure(conn, c["id"], str(exc))
        return "failed"


def _db_identity_problems(conn, r: Record, allow_profile_edits: bool = False) -> list[str]:
    out = []
    s = conn.execute("SELECT * FROM students WHERE student_id = ?", (r.student_code,)).fetchone()
    other = conn.execute("SELECT student_id FROM students WHERE email = ? COLLATE NOCASE AND student_id != ?",
                         (r.email, r.student_code)).fetchone()
    if other:
        out.append(f"email {r.email} belongs to {other['student_id']}")
    if r.passport_id:
        owner = conn.execute("""SELECT s.student_id FROM passports p JOIN students s ON s.id = p.student_fk
                                WHERE p.passport_id = ? AND s.student_id != ?""", (r.passport_id, r.student_code)).fetchone()
        if owner:
            out.append(f"Passport ID {r.passport_id} belongs to {owner['student_id']}")
    if not s:
        return out
    if allow_profile_edits:  # name and email edits are applied by _ensure_student instead
        pass
    elif s["email"].lower() != r.email:
        out.append(f"email is {s['email']} in the system, {r.email} in the sheet")
    if not allow_profile_edits and (s["first_name"], s["last_name"]) != (r.first_name, r.last_name):
        out.append(f"name is {s['first_name']} {s['last_name']} in the system, {r.first_name} {r.last_name} in the sheet")
    p = conn.execute("SELECT * FROM passports WHERE student_fk = ?", (s["id"],)).fetchone()
    if p:
        if r.passport_id and r.passport_id != p["passport_id"]:
            out.append(f"Passport ID is {p['passport_id']} in the system, {r.passport_id} in the sheet")
        if r.first_issued and r.first_issued.isoformat() != p["first_issued_on"]:
            out.append(f"first-issue date is {p['first_issued_on']} in the system, {r.first_issued} in the sheet")
    return out


def _ensure_student(conn, r: Record, counts, edited: set | None = None) -> int:
    s = conn.execute("SELECT * FROM students WHERE student_id = ?", (r.student_code,)).fetchone()
    if s and edited is not None and s["id"] in getattr(edited, "seen", set()):
        return s["id"]  # the student's first row in this run decides their profile
    if s and edited is not None:  # DEMO apply-edits: email and profile follow the sheet
        edited.seen = getattr(edited, "seen", set()) | {s["id"]}
        # The holder's name is fixed on the passport (a database rule), so name edits are not applied.
        new = {"email": r.email, "program": r.program, "education_level": r.education_level,
               "student_status": r.student_status}
        changes = {k: [s[k], v] for k, v in new.items() if (s[k] or "") != (v or "")}
        if changes:
            conn.execute("""UPDATE students SET email = ?, program = ?, education_level = ?, student_status = ?
                            WHERE id = ?""", (*new.values(), s["id"]))
            if changes.keys() - {"student_status"}:
                edited.add(s["id"])
            audit(conn, "STUDENT_EDITED", None, student_id=r.student_code, changes=changes)
        return s["id"]
    if s:
        # profile fields only; name and email are identity and never changed by an import
        conn.execute("UPDATE students SET program = ?, education_level = ?, student_status = ? WHERE id = ?",
                     (r.program, r.education_level, r.student_status, s["id"]))
        return s["id"]
    counts["students_created"] += 1
    return conn.execute(
        """INSERT INTO students (student_id, first_name, last_name, email, source, program, education_level, student_status)
           VALUES (?, ?, ?, ?, 'BTU_TEST_DATA', ?, ?, ?)""",
        (r.student_code, r.first_name, r.last_name, r.email, r.program, r.education_level, r.student_status)).lastrowid


def _ensure_skill(conn, r: Record, run_id: int, v: Validation) -> None:
    k = conn.execute("SELECT * FROM catalog_skills WHERE skill_id = ?", (r.skill_id,)).fetchone()
    if not k:
        conn.execute("INSERT INTO catalog_skills (skill_id, name, category, badge_code, description, first_seen_run) VALUES (?, ?, ?, ?, ?, ?)",
                     (r.skill_id, r.skill_name, r.skill_category, r.badge_code, r.description, run_id))
    elif (k["name"], k["category"], k["description"]) != (r.skill_name, r.skill_category, r.description):
        v.add(r.row, "ERROR", "SKILL_DEFINITION_CONFLICT",
              f"{r.skill_id} is defined as {k['name']!r} ({k['category']}) in the system; the sheet differs")


def _upsert_source(conn, r: Record, state: str, run_id: int, existing) -> None:
    if existing:
        keep = "ACCEPTED" if existing["state"] == "ACCEPTED" else state
        conn.execute("""UPDATE source_records SET student_code = ?, sheet_row = ?, raw_json = ?, fingerprint = ?,
                        state = ?, last_seen_run = ? WHERE record_id = ?""",
                     (r.student_code, r.row.sheet_row, json.dumps(r.raw, ensure_ascii=False), r.fingerprint, keep, run_id, r.record_id))
    else:
        conn.execute("""INSERT INTO source_records (record_id, student_code, sheet_row, raw_json, fingerprint, state,
                        first_seen_run, last_seen_run) VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
                     (r.record_id, r.student_code, r.row.sheet_row, json.dumps(r.raw, ensure_ascii=False), r.fingerprint,
                      state, run_id, run_id))


def _create_passport(conn, student, passport_id: str, first_issued: str) -> None:
    with transaction(conn):
        conn.execute("""INSERT INTO passports (passport_id, student_fk, holder_first_name, holder_last_name, first_issued_on)
                        VALUES (?, ?, ?, ?, ?)""",
                     (passport_id, student["id"], student["first_name"], student["last_name"], first_issued))


def _next_passport_id(conn) -> str:
    nums = [int(x[0][7:]) for x in conn.execute("SELECT passport_id FROM passports") if re.match(r"BTU-AI-\d{6}$", x[0])]
    return f"BTU-AI-{(max(nums) if nums else 0) + 1:06d}"


def _check_stored_pdfs(conn) -> list[dict]:
    """Every issued version's and waiting candidate's file must exist and match its recorded hash.
    Problems are reported, never repaired by silently generating a different document."""
    out = []
    for row in conn.execute("""SELECT p.passport_id, v.version_no, v.pdf_storage_key, v.pdf_sha256
                               FROM passport_versions v JOIN passports p ON p.id = v.passport_fk
                               UNION ALL
                               SELECT p.passport_id, c.version_no, c.pdf_storage_key, c.pdf_sha256
                               FROM version_candidates c JOIN passports p ON p.id = c.passport_fk
                               WHERE c.state = 'AWAITING_REGISTRATION'
                               ORDER BY 1, 2"""):
        f = config.STORAGE_DIR / row["pdf_storage_key"]
        if not f.exists():
            out.append({"passport_id": row["passport_id"], "version": row["version_no"], "problem": "PDF_MISSING"})
        elif hashlib.sha256(f.read_bytes()).hexdigest() != row["pdf_sha256"]:
            out.append({"passport_id": row["passport_id"], "version": row["version_no"], "problem": "PDF_HASH_MISMATCH"})
    return out


def _sheet_status(conn, table: SourceTable, v: Validation, failures, run_id):
    """Q–T per sheet row, from what the system actually did. An existing SYNCED value is kept."""
    issues_by_row = defaultdict(list)
    for i in v.issues:
        if i.sheet_row:
            issues_by_row[i.sheet_row].append(i)
    failed_records = {rid: err for (rids, err) in failures.values() for rid in rids}

    row_status, preserved = {}, []
    now = utc_now()
    for row in table.rows:
        n = row.sheet_row
        rec = v.records.get(n)
        quiet = {"BADGE_FROM_FORMULA"}  # expected after any non-Excel save; kept in the report, not in column T
        msgs = lambda sev: [i.message for i in issues_by_row[n] if i.severity in sev and i.code not in quiet]
        status = version = synced_at = None
        notes = []
        if n in v.rejected:
            status, notes = FAILED, msgs({"ERROR"})
        elif n in v.held:
            status, notes = NOT_SYNCED, msgs({"HOLD"})
        else:
            registered = conn.execute(
                """SELECT v.version_no, v.activated_at, v.issued_at FROM version_source_records x
                   JOIN passport_versions v ON v.id = x.version_fk
                   WHERE x.record_id = ? AND v.chain_tx_hash IS NOT NULL ORDER BY v.version_no LIMIT 1""",
                (rec.record_id,)).fetchone()
            issued = conn.execute(
                """SELECT v.version_no FROM version_source_records x JOIN passport_versions v ON v.id = x.version_fk
                   WHERE x.record_id = ? ORDER BY v.version_no LIMIT 1""", (rec.record_id,)).fetchone()
            waiting = conn.execute(
                """SELECT c.version_no, c.generated_at, c.last_registration_error FROM candidate_records x
                   JOIN version_candidates c ON c.id = x.candidate_fk
                   WHERE x.record_id = ? AND c.state = 'AWAITING_REGISTRATION'""", (rec.record_id,)).fetchone()
            current = conn.execute(
                """SELECT v.version_no FROM skill_awards a JOIN passports p ON p.student_fk = a.student_fk
                   JOIN passport_versions v ON v.passport_fk = p.id AND v.status = 'CURRENT' WHERE a.record_id = ?""",
                (rec.record_id,)).fetchone()
            keep = f"V{current['version_no']}" if current else "no issued passport yet"
            if rec.record_id in failed_records:
                status = FAILED
                notes = [f"PDF generation failed: {failed_records[rec.record_id]}. Current passport remains {keep}; "
                         "will retry on the next sync."]
            elif registered:
                status, version = SYNCED, f"V{registered['version_no']}"
                synced_at = registered["activated_at"] or registered["issued_at"]
            elif issued:
                status = PENDING_CHAIN
                notes = [f"In issued passport V{issued['version_no']}, which is not registered on a blockchain "
                         "(local demo or prototype issue). Never marked SYNCED without registration."]
            elif waiting:
                status = PENDING_CHAIN
                notes = [f"Included in passport V{waiting['version_no']} (PDF generated {waiting['generated_at']}), "
                         f"waiting for blockchain registration. Current valid passport: {keep}."]
                if waiting["last_registration_error"]:
                    notes.append(f"Last registration attempt: {waiting['last_registration_error']}")
            else:
                status, notes = NOT_SYNCED, ["Accepted; waiting for passport generation."]
            notes += msgs({"WARNING"})
        values = {SYNC_STATUS: status, SYNCED_VERSION: version,
                  SYNCED_AT: (synced_at.replace("T", " ")[:16] + " UTC") if synced_at else None,
                  SYNC_NOTES: " | ".join(notes) or None}

        existing = {h: row.outputs.get(h) for h in values}
        # The workbook arrives with SYNCED values that its own notes call simulated. They are not
        # overwritten just because the file was imported; the difference goes in the report.
        # A real failure (FAILED) is still written, because it is a result of this run.
        if str(existing[SYNC_STATUS] or "").strip().upper() == SYNCED and status in (PENDING_CHAIN, NOT_SYNCED):
            preserved.append({"sheet_row": n, "record_id": rec.record_id if rec else None,
                              "sheet_says": f"SYNCED {existing[SYNCED_VERSION] or ''}".strip(),
                              "system_says": status, "detail": " | ".join(notes)})
            values = existing  # not overwritten by an import; difference reported
        row_status[n] = values

        if rec and n not in v.rejected and sum(1 for x in v.records.values() if x.record_id == rec.record_id) == 1:
            conn.execute(
                """INSERT INTO sheet_status (record_id, sync_status, synced_version, synced_at, notes, run_fk, updated_at)
                   VALUES (?, ?, ?, ?, ?, ?, ?)
                   ON CONFLICT(record_id) DO UPDATE SET sync_status = excluded.sync_status,
                     synced_version = excluded.synced_version, synced_at = excluded.synced_at,
                     notes = excluded.notes, run_fk = excluded.run_fk, updated_at = excluded.updated_at""",
                (rec.record_id, status, version, synced_at, " | ".join(notes) or None, run_id, now))
    return row_status, preserved
