"""Stage 3 tests: PDF generation and version management.

    python3 -m unittest worker.tests.test_stage3 -v

Issuance runs in the default blockchain mode. No real registrar exists yet, so new versions wait as
candidates. Where a test needs registration to succeed or fail, it passes a test double
(TestRegistrar) whose transaction hashes say they are not from any chain; the running system has
no such stand-in (worker/chain.py returns None).
"""
from __future__ import annotations

import hashlib
import os
import re
import shutil
import sqlite3
import tempfile
import unittest
from datetime import date, timedelta
from pathlib import Path

import openpyxl
import pymupdf as fitz

from worker import config
from worker.chain import Registration
from worker.db import connect, utc_now
from worker.issue import IssuanceError, generate_candidate, issue_candidate
from worker.pdf.check import PdfCheckError, check_pdf
from worker.pdf.model import Holder, Skill, canonical_payload
from worker.pdf.render import render_passport
from worker.sources.xlsx import read_workbook
from worker.sync import Options, run_import
from worker.tests.test_import import SHEET, WORKBOOK, append_row, copy_row, workbook_rows

TMP_ROOT = Path(tempfile.mkdtemp(prefix="bdp-stage3-"))
BASELINE = None
STUDENT1, PASSPORT1 = "BTU-T-0001", "BTU-AI-000125"
CATS = ["AI Skill", "AI Applied Skill", "AI Advanced Skill"]


def flat(s: str) -> str:
    return re.sub(r"\s+", "", s).upper()


def sha(p: Path) -> str:
    return hashlib.sha256(p.read_bytes()).hexdigest()


class TestRegistrar:
    """Test double. Records what it was asked to register; can be told to fail."""
    def __init__(self, fail: str | None = None):
        self.fail, self.calls = fail, []

    def register(self, candidate, passport_ref=None, pdf_bytes=None, on_submitted=None) -> Registration:
        self.calls.append(candidate["verification_code"])
        if self.fail:
            raise RuntimeError(self.fail)
        return Registration(tx_hash=f"TEST-NOT-A-CHAIN-TX-{len(self.calls)}", network="unit-test (no chain)",
                            pdf_sha256=candidate["pdf_sha256"], registered_at=utc_now())


def edited(name: str, edit) -> Path:
    wb = openpyxl.load_workbook(WORKBOOK)
    edit(wb[SHEET])
    TMP_ROOT.mkdir(parents=True, exist_ok=True)  # also used by later test modules
    out = TMP_ROOT / f"{name}.xlsx"
    wb.save(out)
    return out


def with_new_skills(name: str, student: str, *record_ids: str) -> Path:
    """The real workbook plus new skill rows for one student (real skill definitions they don't hold)."""
    rows = workbook_rows()
    src = next(r for r in rows if r["Student ID"] == student)
    held, defs = {r["Skill ID"] for r in rows if r["Student ID"] == student}, []
    for r in rows:
        if r["Skill ID"] not in held:
            held.add(r["Skill ID"])
            defs.append({h: r[h] for h in ("Skill ID", "Skill Name", "Skill Category", "Skill Description")}
                        | {"Badge/Stamp Code": f"BDG-AI-00{CATS.index(r['Skill Category']) + 1}"})

    def edit(ws):
        for rid, d in zip(record_ids, defs):
            append_row(ws, copy_row(ws, src["_row"], **{"Record ID": rid, **d}))
    return edited(name, edit)


def synthetic_skills(n: int, description="Synthetic description for testing the passport layout.") -> list[Skill]:
    return [Skill(f"REC-9{i:03d}", f"SKL-{900 + i}", f"Synthetic Skill {i + 1}", CATS[i % 3], f"BDG-AI-00{i % 3 + 1}",
                  description, date(2026, 1, 5) + timedelta(days=i)) for i in range(n)]


def render_and_check(holder: Holder, name: str):
    out = TMP_ROOT / "render" / f"{name}.pdf"
    issued = "2026-10-21T09:00:00Z"
    payload = canonical_payload(holder, 1, issued)
    layout = render_passport(holder, 1, issued, "BTU-TEST-0000-0001", "https://example.invalid/verify/x", payload, out)
    return out, layout, check_pdf(out.read_bytes(), layout, payload)


def setUpModule():
    global BASELINE
    config.ISSUANCE_MODE = "blockchain"
    BASELINE = TMP_ROOT / "baseline"
    config.set_data_dir(BASELINE)
    conn = connect()
    run_import(conn, read_workbook(WORKBOOK))  # no registrar: 18 candidates wait
    conn.close()


def tearDownModule():
    shutil.rmtree(TMP_ROOT, ignore_errors=True)


class Base(unittest.TestCase):
    def setUp(self):
        self.dir = TMP_ROOT / f"case-{self.id().split('.')[-1]}"
        shutil.copytree(BASELINE, self.dir)
        config.set_data_dir(self.dir)
        config.ISSUANCE_MODE = "blockchain"
        self.conn = connect()

    def tearDown(self):
        self.conn.close()
        config.ISSUANCE_MODE = "blockchain"

    def q(self, sql, *args):
        return self.conn.execute(sql, args).fetchall()

    def one(self, sql, *args):
        return self.conn.execute(sql, args).fetchone()

    def sync(self, path=WORKBOOK, **opts):
        table = read_workbook(path)
        return table, run_import(self.conn, table, Options(**opts))

    def pid(self, passport_id=PASSPORT1):
        return self.one("SELECT id FROM passports WHERE passport_id = ?", passport_id)[0]

    def versions(self, passport_id=PASSPORT1):
        return self.q("SELECT * FROM passport_versions WHERE passport_fk = ? ORDER BY version_no", self.pid(passport_id))

    def candidates(self, passport_id=PASSPORT1):
        return self.q("SELECT * FROM version_candidates WHERE passport_fk = ? ORDER BY version_no", self.pid(passport_id))

    def text(self, key: str) -> str:
        return " ".join(p.get_text() for p in fitz.open(config.STORAGE_DIR / key))

    def fresh_row(self, table) -> str:
        """A record whose workbook status was NOT SYNCED (the workbook's SYNCED values are kept as found)."""
        return next(r.values["Record ID"] for r in table.rows if r.outputs.get("Passport Sync Status") == "NOT SYNCED")

    def status_of(self, result, table, record_id):
        row = next(r.sheet_row for r in table.rows if r.values["Record ID"] == record_id)
        return result.row_status[row]


# ---------------------------------------------------------------------------------------------

class S01FirstIssuance(Base):
    def test_generated_pdfs_wait_for_registration_and_nothing_is_marked_synced(self):
        self.assertEqual(self.one("SELECT COUNT(*) FROM version_candidates WHERE state = 'AWAITING_REGISTRATION'")[0], 18)
        self.assertEqual(self.one("SELECT COUNT(*) FROM passport_versions")[0], 0, "nothing issued without registration")
        t, res = self.sync()
        self.assertEqual(res.summary["versions_generated"], 0, "unchanged data: no duplicates")
        self.assertEqual(res.summary["awaiting_registration"], 18)
        statuses = {v["Passport Sync Status"] for v in res.row_status.values()}
        self.assertEqual(self.one("SELECT COUNT(*) FROM sheet_status WHERE sync_status = 'SYNCED'")[0], 0)
        self.assertIn("PENDING BLOCKCHAIN", statuses)
        st = self.status_of(res, t, self.fresh_row(t))
        self.assertEqual(st["Passport Sync Status"], "PENDING BLOCKCHAIN")
        self.assertIn("waiting for blockchain registration", st["Sync Error / Notes"])
        self.assertIsNone(st["Synced Passport Version"])

    def test_registration_issues_v1_with_identity_skills_and_code(self):
        reg = TestRegistrar()
        t, res = self.sync(registrar=reg)
        self.assertEqual(res.summary["issued_registered"], 18)
        v1 = self.versions()[0]
        self.assertEqual((v1["version_no"], v1["status"]), (1, "CURRENT"))
        self.assertTrue(v1["chain_tx_hash"].startswith("TEST-NOT-A-CHAIN"))
        text = flat(self.text(v1["pdf_storage_key"]))
        p = self.one("SELECT * FROM passports WHERE passport_id = ?", PASSPORT1)
        for s in (p["holder_first_name"].upper(), p["holder_last_name"].upper(), PASSPORT1, v1["verification_code"],
                  date.fromisoformat(p["first_issued_on"]).strftime("%d.%m.%Y")):
            self.assertIn(flat(s), text)
        for r in workbook_rows():
            if r["Student ID"] == STUDENT1:
                for field in ("Skill Name", "Skill Description", "Record ID"):
                    self.assertIn(flat(r[field]), text)

        for a in self.q("SELECT a.date_earned FROM skill_awards a JOIN students s ON s.id = a.student_fk WHERE s.student_id = ?", STUDENT1):
            self.assertIn(date.fromisoformat(a[0]).strftime("%d.%m.%Y"), text)
        self.assertEqual(self.status_of(res, t, self.fresh_row(t))["Synced Passport Version"], "V1")

    def test_hash_is_of_the_exact_stored_bytes(self):
        for c in self.q("SELECT * FROM version_candidates"):
            self.assertEqual(sha(config.STORAGE_DIR / c["pdf_storage_key"]), c["pdf_sha256"])
        before = {c["pdf_storage_key"]: sha(config.STORAGE_DIR / c["pdf_storage_key"]) for c in self.q("SELECT * FROM version_candidates")}
        self.sync(registrar=TestRegistrar())
        for v in self.q("SELECT * FROM passport_versions"):
            self.assertEqual(sha(config.STORAGE_DIR / v["pdf_storage_key"]), before[v["pdf_storage_key"]], "issuing never rewrites the file")


class S02SubsequentUpdates(Base):
    def test_new_skill_makes_v2_and_keeps_v1(self):
        self.sync(registrar=TestRegistrar())
        v1 = self.versions()[0]
        v1_bytes = sha(config.STORAGE_DIR / v1["pdf_storage_key"])
        path = with_new_skills("v2", STUDENT1, "REC-0801")

        _, res = self.sync(path)  # no registrar: V2 generated but V1 stays the valid passport
        self.assertEqual(res.summary["versions_generated"], 1)
        self.assertEqual([(v["version_no"], v["status"]) for v in self.versions()], [(1, "CURRENT")])
        self.assertEqual(self.candidates()[-1]["state"], "AWAITING_REGISTRATION")

        t, res = self.sync(path, registrar=TestRegistrar())
        self.assertEqual([(v["version_no"], v["status"]) for v in self.versions()], [(1, "SUPERSEDED"), (2, "CURRENT")])
        v1b, v2 = self.versions()
        self.assertEqual(sha(config.STORAGE_DIR / v1b["pdf_storage_key"]), v1_bytes, "V1 file preserved byte for byte")
        self.assertEqual((v1b["verification_code"], v1b["issued_at"], v1b["chain_tx_hash"]),
                         (v1["verification_code"], v1["issued_at"], v1["chain_tx_hash"]), "V1 metadata preserved")
        self.assertNotEqual(v2["verification_code"], v1["verification_code"])
        text1, text2 = self.text(v1["pdf_storage_key"]), self.text(v2["pdf_storage_key"])
        first_issued = re.search(r"\d\d\.\d\d\.\d{4}", text1).group(0)
        self.assertIn(first_issued, text2)
        self.assertIn(PASSPORT1, text2)
        self.assertIn(flat(self.one("SELECT skill_name FROM skill_awards WHERE record_id = 'REC-0801'")[0]), flat(text2))
        self.assertEqual(self.status_of(res, t, "REC-0801")["Synced Passport Version"], "V2")
        self.assertEqual(self.status_of(res, t, self.fresh_row(t))["Synced Passport Version"], "V1", "first version that held it")

    def test_rerunning_unchanged_data_creates_nothing(self):
        path = with_new_skills("rerun", STUDENT1, "REC-0802")
        self.sync(path)
        counts = [self.one(f"SELECT COUNT(*) FROM {t}")[0] for t in ("version_candidates", "passport_versions")]
        files = sorted((config.STORAGE_DIR / "passports").rglob("*.pdf"))
        for _ in range(2):
            _, res = self.sync(path)
            self.assertEqual(res.summary["versions_generated"], 0)
        self.assertEqual([self.one(f"SELECT COUNT(*) FROM {t}")[0] for t in ("version_candidates", "passport_versions")], counts)
        self.assertEqual(sorted((config.STORAGE_DIR / "passports").rglob("*.pdf")), files)

    def test_a_newer_change_replaces_a_waiting_candidate_which_is_kept_but_never_issued(self):
        self.sync(registrar=TestRegistrar())
        self.sync(with_new_skills("one-more", STUDENT1, "REC-0803"))
        self.sync(with_new_skills("two-more", STUDENT1, "REC-0803", "REC-0804"))
        cands = self.candidates()
        self.assertEqual([(c["version_no"], c["state"]) for c in cands], [(1, "ISSUED"), (2, "VOID"), (3, "AWAITING_REGISTRATION")])
        self.assertTrue((config.STORAGE_DIR / cands[1]["pdf_storage_key"]).exists(), "void file kept for the record")
        self.sync(with_new_skills("two-more-b", STUDENT1, "REC-0803", "REC-0804"), registrar=TestRegistrar())
        self.assertEqual([(v["version_no"], v["status"]) for v in self.versions()], [(1, "SUPERSEDED"), (3, "CURRENT")])

    def test_passport_identity_and_issued_versions_cannot_be_changed(self):
        self.sync(registrar=TestRegistrar())
        for sql in ("UPDATE passports SET first_issued_on = '2030-01-01'",
                    "UPDATE passports SET passport_id = 'BTU-AI-999999' WHERE passport_id = 'BTU-AI-000125'",
                    "UPDATE passports SET holder_last_name = 'X'",
                    "UPDATE passport_versions SET pdf_sha256 = 'x'",
                    "UPDATE passport_versions SET verification_code = 'BTU-AAAA-AAAA-AAAA'",
                    "UPDATE passport_versions SET chain_tx_hash = 'other'",
                    "DELETE FROM passport_versions", "DELETE FROM version_candidates", "DELETE FROM passports"):
            with self.subTest(sql=sql), self.assertRaises(sqlite3.IntegrityError):
                self.conn.execute(sql)
        self.conn.execute("UPDATE passport_versions SET status = 'SUPERSEDED' WHERE id = 1")
        with self.assertRaises(sqlite3.IntegrityError):
            self.conn.execute("UPDATE passport_versions SET status = 'CURRENT' WHERE id = 1")


class S03UniqueCodes(Base):
    def test_every_version_and_candidate_has_its_own_code(self):
        self.sync(registrar=TestRegistrar())
        self.sync(with_new_skills("codes", STUDENT1, "REC-0805"), registrar=TestRegistrar())
        codes = [r[0] for r in self.q("SELECT verification_code FROM version_candidates")]
        self.assertEqual(len(codes), 19)
        self.assertEqual(len(set(codes)), len(codes))
        for c in codes:
            self.assertRegex(c, r"^BTU-[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}$")
        self.assertEqual({r[0] for r in self.q("SELECT verification_code FROM passport_versions")} - set(codes), set())


class S04FailureRecovery(Base):
    def test_registration_failure_keeps_the_previous_version(self):
        self.sync(registrar=TestRegistrar())
        path = with_new_skills("reg-fail", STUDENT1, "REC-0806")
        t, res = self.sync(path, registrar=TestRegistrar(fail="RPC unreachable (simulated)"))
        self.assertEqual(res.summary["issuance_failures"], 1)
        self.assertEqual([(v["version_no"], v["status"]) for v in self.versions()], [(1, "CURRENT")])
        c = self.candidates()[-1]
        self.assertEqual((c["state"], c["registration_attempts"]), ("AWAITING_REGISTRATION", 1))
        st = self.status_of(res, t, "REC-0806")
        self.assertEqual(st["Passport Sync Status"], "PENDING BLOCKCHAIN")
        self.assertIn("RPC unreachable", st["Sync Error / Notes"])
        self.assertIn("Current valid passport: V1", st["Sync Error / Notes"])

        _, res = self.sync(path, registrar=TestRegistrar())  # retried, same candidate, same file
        self.assertEqual(res.summary["versions_generated"], 0)
        self.assertEqual([(v["version_no"], v["status"]) for v in self.versions()], [(1, "SUPERSEDED"), (2, "CURRENT")])
        self.assertEqual(self.versions()[1]["pdf_sha256"], c["pdf_sha256"])

    def test_generation_failure_keeps_the_previous_version(self):
        self.sync(registrar=TestRegistrar())
        os.environ["PASSPORT_ASSETS_DIR"] = str(self.dir / "no-assets")
        try:
            t, res = self.sync(with_new_skills("gen-fail", STUDENT1, "REC-0807"), registrar=TestRegistrar())
        finally:
            del os.environ["PASSPORT_ASSETS_DIR"]
        self.assertEqual(res.summary["generation_failures"], 1)
        self.assertEqual(len(self.candidates()), 1)
        self.assertEqual([(v["version_no"], v["status"]) for v in self.versions()], [(1, "CURRENT")])
        self.assertEqual(self.status_of(res, t, "REC-0807")["Passport Sync Status"], "FAILED")

    def test_a_pdf_that_fails_its_check_is_never_stored_or_issued(self):
        def wrong_renderer(holder, version, issued_at, code, url, payload, out):
            # a document that leaves out a skill while claiming the full data
            short = Holder(holder.passport_id, holder.first_name, holder.last_name, holder.first_issued, holder.skills[:-1])
            layout = render_passport(short, version, issued_at, code, url, canonical_payload(short, version, issued_at), out)
            return layout
        self.sync(registrar=TestRegistrar())
        files = sorted((config.STORAGE_DIR / "passports").rglob("*.pdf"))
        _, res = self.sync(with_new_skills("bad-pdf", STUDENT1, "REC-0808"), renderer=wrong_renderer, registrar=TestRegistrar())
        self.assertEqual(res.summary["generation_failures"], 1)
        err = self.one("SELECT error FROM generation_failures")[0]
        self.assertIn("PDF check failed", err)
        self.assertEqual(sorted((config.STORAGE_DIR / "passports").rglob("*.pdf")), files)
        self.assertEqual([(v["version_no"], v["status"]) for v in self.versions()], [(1, "CURRENT")])

    def test_changed_stored_file_is_not_issued(self):
        path = with_new_skills("tampered", STUDENT1, "REC-0809")
        self.sync(registrar=TestRegistrar())
        self.sync(path)
        c = self.candidates()[-1]
        f = config.STORAGE_DIR / c["pdf_storage_key"]
        f.write_bytes(f.read_bytes() + b"\n%tampered")
        with self.assertRaises(IssuanceError):
            issue_candidate(self.conn, c["id"], TestRegistrar().register(c))
        _, res = self.sync(path, registrar=TestRegistrar())
        self.assertEqual(res.summary["issuance_failures"], 1)
        self.assertEqual([(v["version_no"], v["status"]) for v in self.versions()], [(1, "CURRENT")])

    def test_registration_for_another_hash_is_refused(self):
        c = self.candidates()[0]
        bad = Registration("TEST-NOT-A-CHAIN-TX", "unit-test", "0" * 64, utc_now())
        with self.assertRaises(IssuanceError):
            issue_candidate(self.conn, c["id"], bad)
        with self.assertRaises(IssuanceError):
            issue_candidate(self.conn, c["id"], None)  # no registration, not local-demo


class S05LocalDemoMode(Base):
    def test_local_demo_issues_without_a_chain_and_never_claims_synced(self):
        config.ISSUANCE_MODE = "local-demo"
        t, res = self.sync()
        self.assertEqual(res.summary["issued_unregistered_demo"], 18)
        v1 = self.versions()[0]
        self.assertEqual(v1["status"], "CURRENT")
        self.assertIsNone(v1["chain_tx_hash"])
        self.assertEqual(self.one("SELECT COUNT(*) FROM sheet_status WHERE sync_status = 'SYNCED'")[0], 0)
        st = self.status_of(res, t, self.fresh_row(t))
        self.assertEqual(st["Passport Sync Status"], "PENDING BLOCKCHAIN")
        self.assertIsNone(st["Synced Passport Version"])


class S06Layout(unittest.TestCase):
    """Renderer and read-back check on synthetic holders (no database)."""
    holder = staticmethod(lambda skills, first="Sample", last="Student": Holder("BTU-AI-900001", first, last, date(2026, 3, 1), skills))

    def test_page_count_follows_the_number_of_skills(self):
        for n, pages in ((0, 4), (1, 4), (5, 4), (6, 5), (10, 5), (11, 7), (23, 10), (40, 14)):
            with self.subTest(skills=n):
                _, layout, checked = render_and_check(self.holder(synthetic_skills(n)), f"n{n}")
                self.assertEqual(checked["pages"], pages)

    def test_every_skill_appears_in_full_on_a_many_page_passport(self):
        out, _, checked = render_and_check(self.holder(synthetic_skills(23)), "many")
        text = " ".join(p.get_text() for p in fitz.open(out)).upper()
        for s in synthetic_skills(23):
            self.assertIn(s.record_id, text)
            self.assertIn(s.date_earned.strftime("%d.%m.%Y"), text)
        self.assertEqual(checked["cells_checked"], 23 * 5)

    def test_empty_skill_list_renders_a_clear_note(self):
        out, _, checked = render_and_check(self.holder([]), "empty")
        self.assertEqual(checked["pages"], 4)
        self.assertIn("NO CONFIRMED AI SKILLS RECORDED YET", fitz.open(out)[2].get_text())

    def test_long_descriptions_continue_on_extra_pages_without_losing_text(self):
        long = " ".join(["This synthetic description is deliberately long so that it cannot fit in one table cell."] * 9)
        word = "Unbreakable" * 12
        skills = synthetic_skills(7)
        skills[1] = Skill(**{**skills[1].__dict__, "description": long})
        skills[6] = Skill(**{**skills[6].__dict__, "description": f"{word} {long}"})
        skills[3] = Skill(**{**skills[3].__dict__, "name": "An Unusually Long Synthetic Skill Name " * 5})
        out, layout, checked = render_and_check(self.holder(skills), "long")
        self.assertEqual(checked["continuation_pages"], 1)
        self.assertEqual(set(checked["continued_records"]), {skills[1].record_id, skills[3].record_id, skills[6].record_id})
        cont = fitz.open(out)[layout.continuation_pages[0]].get_text()
        self.assertIn("TEMPORARY LAYOUT", cont)
        self.assertIn(re.sub(r"\s+", "", long), re.sub(r"\s+", "", cont))
        self.assertIn(word, re.sub(r"\s+", "", cont))
        supp = fitz.open(out)[layout.supplement_pages[0]].get_text()
        self.assertIn(f"CONTINUED ON PAGE {layout.continuation_pages[0] + 1}", supp)

    def test_many_long_descriptions_flow_over_several_continuation_pages(self):
        long = " ".join(["Another deliberately long synthetic description used to fill continuation pages."] * 14)
        skills = [Skill(**{**s.__dict__, "description": long}) for s in synthetic_skills(12)]
        _, _, checked = render_and_check(self.holder(skills), "flow")
        self.assertGreaterEqual(checked["continuation_pages"], 2)
        self.assertEqual(len(checked["continued_records"]), 12)

    def test_georgian_names_render_and_check(self):
        _, _, checked = render_and_check(self.holder(synthetic_skills(2), "ნინო", "ბერიძე"), "geo")
        self.assertEqual(checked["pages"], 4)

    def test_the_check_rejects_a_document_that_does_not_match(self):
        h = self.holder(synthetic_skills(3))
        out, layout, _ = render_and_check(h, "mismatch")
        data = out.read_bytes()
        other = canonical_payload(self.holder(synthetic_skills(2)), 1, "2026-10-21T09:00:00Z")
        with self.assertRaises(PdfCheckError):
            check_pdf(data, layout, other)
        with self.assertRaises(PdfCheckError):
            check_pdf(data[: len(data) // 2], layout, canonical_payload(h, 1, "2026-10-21T09:00:00Z"))
        layout.code = "BTU-ZZZZ-ZZZZ-ZZZZ"
        with self.assertRaises(PdfCheckError):
            check_pdf(data, layout, canonical_payload(h, 1, "2026-10-21T09:00:00Z"))


class S07EmptyPassportIssuance(Base):
    def test_a_passport_with_no_skills_can_be_generated(self):
        sid = self.conn.execute("""INSERT INTO students (student_id, first_name, last_name, email, source)
                                   VALUES ('SEED-S3-0001', 'Sample', 'Empty', 'sample.empty@example.org', 'SEED_SYNTHETIC')""").lastrowid
        pid = self.conn.execute("""INSERT INTO passports (passport_id, student_fk, holder_first_name, holder_last_name, first_issued_on)
                                   VALUES ('BTU-AI-900099', ?, 'Sample', 'Empty', '2026-10-01')""", (sid,)).lastrowid
        res = generate_candidate(self.conn, pid, [])
        self.assertEqual((res["version_no"], res["check"]["pages"]), (1, 4))
        self.assertIn("NO CONFIRMED AI SKILLS", self.text(self.one("SELECT pdf_storage_key FROM version_candidates WHERE id = ?", res["candidate_id"])[0]))


if __name__ == "__main__":
    unittest.main()
