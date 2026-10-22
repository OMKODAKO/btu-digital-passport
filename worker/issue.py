"""Generating and issuing passport versions.

Two steps, so the current valid PDF is never replaced by something unfinished:

 1. generate_candidate(): render with BTU's template, read the finished bytes back and check them
    (pdf/check.py), hash the final bytes, store the file under a key it can never overwrite, and
    record it as an AWAITING_REGISTRATION candidate. The student's current version is untouched.
 2. issue_candidate(): only after the issuance steps succeed (blockchain registration, or the
    explicitly chosen local-demo mode) the candidate becomes the CURRENT passport version and the
    previous one SUPERSEDED, in one transaction.

If anything fails, the previous version stays current and every earlier PDF stays as it was.
"""
from __future__ import annotations

import hashlib
import json
import os
import secrets
import sqlite3
import uuid
from datetime import date
from pathlib import Path

from . import config
from .db import audit, transaction, utc_now
from .pdf.check import check_pdf
from .pdf.model import Holder, Skill, canonical_payload
from .pdf.render import render_passport

CODE_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"  # Crockford base32: no I, L, O, U


class IssuanceError(Exception):
    pass


def new_verification_code(conn: sqlite3.Connection) -> str:
    """60 random bits, e.g. BTU-7RZ7-GZNH-QKWL, unique across every version and candidate."""
    while True:
        chars = "".join(secrets.choice(CODE_ALPHABET) for _ in range(12))
        code = f"BTU-{chars[:4]}-{chars[4:8]}-{chars[8:]}"
        taken = conn.execute(
            """SELECT 1 FROM passport_versions WHERE verification_code = ?
               UNION ALL SELECT 1 FROM version_candidates WHERE verification_code = ?""", (code, code)).fetchone()
        if not taken:
            return code


def waiting_candidate(conn: sqlite3.Connection, passport_fk: int):
    return conn.execute("SELECT * FROM version_candidates WHERE passport_fk = ? AND state = 'AWAITING_REGISTRATION'",
                        (passport_fk,)).fetchone()


def _holder(conn, passport_fk: int, record_ids: list[str]) -> Holder:
    p = conn.execute("SELECT * FROM passports WHERE id = ?", (passport_fk,)).fetchone()
    awards = conn.execute(
        f"SELECT * FROM skill_awards WHERE student_fk = ? AND record_id IN ({','.join('?' * len(record_ids))})",
        (p["student_fk"], *record_ids)).fetchall() if record_ids else []
    missing = sorted(set(record_ids) - {a["record_id"] for a in awards})
    if missing:
        raise IssuanceError(f"No accepted skill for record(s) {missing} of {p['passport_id']}; refusing to drop or invent skills")
    skills = sorted(
        (Skill(record_id=a["record_id"], skill_id=a["skill_id"], name=a["skill_name"], category=a["skill_category"],
               badge_code=a["badge_code"], description=a["description"], date_earned=date.fromisoformat(a["date_earned"]))
         for a in awards),
        key=lambda s: (s.date_earned, s.record_id),
    )
    # Name, Passport ID and first-issue date come from the passport row, frozen at first issuance.
    s = conn.execute("SELECT program, education_level FROM students WHERE id = ?", (p["student_fk"],)).fetchone()
    return Holder(passport_id=p["passport_id"], first_name=p["holder_first_name"], last_name=p["holder_last_name"],
                  first_issued=date.fromisoformat(p["first_issued_on"]), skills=skills,
                  program=(s["program"] or "") if s else "", education_level=(s["education_level"] or "") if s else "")


def generate_candidate(conn: sqlite3.Connection, passport_fk: int, record_ids: list[str], renderer=None) -> dict:
    """Renders, checks and stores version N+1 containing exactly these source records, as a candidate.
    A waiting candidate it replaces becomes VOID (kept, never issued). Raises on any failure."""
    renderer = renderer or render_passport
    holder = _holder(conn, passport_fk, record_ids)
    version_no = conn.execute(
        """SELECT MAX(n) + 1 FROM (SELECT COALESCE(MAX(version_no), 0) AS n FROM passport_versions WHERE passport_fk = ?
                                   UNION ALL SELECT COALESCE(MAX(version_no), 0) FROM version_candidates WHERE passport_fk = ?)""",
        (passport_fk, passport_fk)).fetchone()[0]
    code = new_verification_code(conn)
    generated_at = utc_now()
    payload = canonical_payload(holder, version_no, generated_at)

    key = f"passports/{holder.passport_id}/V{version_no}-{code}.pdf"
    final = config.STORAGE_DIR / key
    tmp = config.STORAGE_DIR / ".tmp" / f"{uuid.uuid4().hex}.pdf"
    tmp.parent.mkdir(parents=True, exist_ok=True)
    final.parent.mkdir(parents=True, exist_ok=True)
    placed = False
    try:
        layout = renderer(holder, version_no, generated_at, code, f"{config.VERIFY_BASE_URL}/{code}", payload, tmp)
        data = tmp.read_bytes()
        checked = check_pdf(data, layout, payload)         # reads the finished document back
        digest = hashlib.sha256(data).hexdigest()           # hash of the final bytes, nothing reconstructed
        os.link(tmp, final)  # fails if the key already exists: a stored file is never replaced
        placed = True
        if hashlib.sha256(final.read_bytes()).hexdigest() != digest:
            raise IssuanceError("stored PDF does not match the rendered bytes")

        with transaction(conn):
            old = waiting_candidate(conn, passport_fk)
            if old:
                conn.execute("UPDATE version_candidates SET state = 'VOID', void_reason = ? WHERE id = ?",
                             (f"replaced by V{version_no} before it was issued", old["id"]))
            cid = conn.execute(
                """INSERT INTO version_candidates (passport_fk, version_no, verification_code, state, generated_at,
                                                   pdf_storage_key, pdf_sha256, pdf_check_json)
                   VALUES (?, ?, ?, 'AWAITING_REGISTRATION', ?, ?, ?, ?)""",
                (passport_fk, version_no, code, generated_at, key, digest, json.dumps(checked))).lastrowid
            conn.executemany("INSERT INTO candidate_records (candidate_fk, record_id) VALUES (?, ?)",
                             [(cid, rid) for rid in record_ids])
            audit(conn, "VERSION_GENERATED", passport_fk, version_no=version_no, verification_code=code,
                  pdf_sha256=digest, records=len(record_ids),
                  **({"voided_version_no": old["version_no"]} if old else {}))
    except BaseException:
        if placed:
            final.unlink(missing_ok=True)  # never referenced by the database, so safe to remove
        raise
    finally:
        tmp.unlink(missing_ok=True)
    return {"candidate_id": cid, "version_no": version_no, "verification_code": code, "generated_at": generated_at,
            "pdf_sha256": digest, "check": checked}


def issue_candidate(conn: sqlite3.Connection, candidate_id: int, registration=None, *, unregistered_demo=False) -> dict:
    """Makes a candidate the CURRENT version. Needs a successful blockchain Registration for exactly
    this file, unless unregistered_demo is set (local-demo mode: issued with chain_tx_hash NULL)."""
    c = conn.execute("SELECT * FROM version_candidates WHERE id = ?", (candidate_id,)).fetchone()
    if c is None or c["state"] != "AWAITING_REGISTRATION":
        raise IssuanceError(f"candidate {candidate_id} is not waiting to be issued")
    if registration is None and not unregistered_demo:
        raise IssuanceError("no blockchain registration; the candidate stays waiting")
    if registration is not None and registration.pdf_sha256 != c["pdf_sha256"]:
        raise IssuanceError("the registered hash is not this candidate's PDF hash")
    stored = config.STORAGE_DIR / c["pdf_storage_key"]
    if not stored.exists() or hashlib.sha256(stored.read_bytes()).hexdigest() != c["pdf_sha256"]:
        raise IssuanceError("the stored candidate PDF is missing or changed; not issued")

    now = utc_now()
    with transaction(conn):
        conn.execute("UPDATE passport_versions SET status = 'SUPERSEDED' WHERE passport_fk = ? AND status = 'CURRENT'",
                     (c["passport_fk"],))
        r = registration
        vid = conn.execute(
            """INSERT INTO passport_versions (passport_fk, version_no, verification_code, status, issued_at, pdf_storage_key,
                                              pdf_sha256, chain_tx_hash, activated_at, candidate_fk, chain_id, chain_network,
                                              chain_contract, chain_block_number, chain_block_hash, chain_issuer,
                                              chain_issuer_label, chain_issuer_test_only, chain_registered_at, chain_confirmations)
               VALUES (?, ?, ?, 'CURRENT', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (c["passport_fk"], c["version_no"], c["verification_code"], c["generated_at"], c["pdf_storage_key"],
             c["pdf_sha256"], r.tx_hash if r else None, now, c["id"],
             *((r.chain_id, r.network, r.contract, r.block_number, r.block_hash, r.issuer, r.issuer_label,
                int(r.issuer_test_only), r.registered_at, r.confirmations) if r else (None,) * 10))).lastrowid
        conn.execute("""INSERT INTO version_source_records (version_fk, record_id)
                        SELECT ?, record_id FROM candidate_records WHERE candidate_fk = ?""", (vid, c["id"]))
        conn.execute("UPDATE version_candidates SET state = 'ISSUED', issued_version_fk = ? WHERE id = ?", (vid, c["id"]))
        audit(conn, "VERSION_ISSUED", c["passport_fk"], version_no=c["version_no"],
              verification_code=c["verification_code"], chain_tx_hash=r.tx_hash if r else None,
              chain_network=r.network if r else None, unregistered_demo=r is None)
    return {"version_id": vid, "version_no": c["version_no"], "chain_tx_hash": registration.tx_hash if registration else None}


def chain_ref(conn: sqlite3.Connection, passport_fk: int) -> str:
    """The passport's random on-chain reference (32 bytes, hex), created on first use and then fixed."""
    row = conn.execute("SELECT chain_ref FROM passports WHERE id = ?", (passport_fk,)).fetchone()
    if row["chain_ref"]:
        return row["chain_ref"]
    ref = secrets.token_hex(32)
    conn.execute("UPDATE passports SET chain_ref = ? WHERE id = ? AND chain_ref IS NULL", (ref, passport_fk))
    return conn.execute("SELECT chain_ref FROM passports WHERE id = ?", (passport_fk,)).fetchone()["chain_ref"]


def record_submitted_tx(conn: sqlite3.Connection, candidate_id: int, tx_hash: str) -> None:
    conn.execute("UPDATE version_candidates SET chain_tx_submitted = ?, chain_tx_submitted_at = ? WHERE id = ?",
                 (tx_hash, utc_now(), candidate_id))


def record_registration_failure(conn: sqlite3.Connection, candidate_id: int, error: str) -> None:
    conn.execute("""UPDATE version_candidates SET registration_attempts = registration_attempts + 1,
                    last_registration_error = ? WHERE id = ?""", (error[:500], candidate_id))
    c = conn.execute("SELECT passport_fk, version_no FROM version_candidates WHERE id = ?", (candidate_id,)).fetchone()
    if c:
        audit(conn, "REGISTRATION_FAILED", c["passport_fk"], version_no=c["version_no"], error=error[:300])
