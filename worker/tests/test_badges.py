"""Subject stage 05 tests: subject badges printed on the passport and versioned like skills.

    python3 -m unittest worker.tests.test_badges -v

Runs in temporary folders in local-demo issuance mode: no blockchain, no Google Sheet, no live data.
"""
from __future__ import annotations

import json
import shutil
import sqlite3
import tempfile
import unittest
from pathlib import Path

import pymupdf as fitz

from worker import config
from worker.__main__ import main as cli
from worker.db import connect
from worker.sources.xlsx import read_workbook
from worker.subjects import load_catalog
from worker.subjects.badges import current_badges, publish
from worker.subjects.grades import record_marks
from worker.sync import run_import
from worker.tests.test_import import WORKBOOK

TMP_ROOT = Path(tempfile.mkdtemp(prefix="bdp-badges-"))
ST1 = "BTU-T-0001"
VIBE = "SUBJ-VIBE-CODING"   # Quizzes 15, Assignments 20, Agent project 10, Midterm exam 25, Final exam 30
GOLD = {"Quizzes": 12, "Assignments": 15, "Agent project": 8, "Midterm exam": 19, "Final exam": 23}   # 77.00


def setUpModule():
    config.ISSUANCE_MODE = "local-demo"
    config.set_data_dir(TMP_ROOT / "baseline")
    conn = connect()
    run_import(conn, read_workbook(WORKBOOK), _options())
    load_catalog(conn)
    conn.close()


def tearDownModule():
    shutil.rmtree(TMP_ROOT, ignore_errors=True)


def _options():
    from worker.sync import Options
    return Options(registrar=None)


class BadgesTest(unittest.TestCase):
    def setUp(self):
        d = TMP_ROOT / self.id().rsplit(".", 1)[-1]
        shutil.copytree(TMP_ROOT / "baseline", d)
        config.set_data_dir(d)
        self.conn = connect()
        self.sfk = self.conn.execute("SELECT id FROM students WHERE student_id = ?", (ST1,)).fetchone()[0]
        self.pfk = self.conn.execute("SELECT id FROM passports WHERE student_fk = ?", (self.sfk,)).fetchone()[0]

    def tearDown(self):
        self.conn.close()

    def current(self, pfk=None):
        return self.conn.execute("SELECT * FROM passport_versions WHERE passport_fk = ? AND status = 'CURRENT'",
                                 (pfk or self.pfk,)).fetchone()

    def pdf(self, version):
        return fitz.open(config.STORAGE_DIR / version["pdf_storage_key"])

    def publish(self, **kw):
        return publish(self.conn, registrar=None, **kw)

    def test_a_badge_makes_a_new_version_that_keeps_every_skill(self):
        before = self.current()
        skills_before = {r[0] for r in self.conn.execute(
            "SELECT record_id FROM version_source_records WHERE version_fk = ?", (before["id"],))}
        record_marks(self.conn, ST1, VIBE, GOLD, entered_by="t")
        r = self.publish()
        self.assertEqual([(x["student"], x["generation"], x["issuance"]) for x in r], [(ST1, "generated", "demo")])

        now = self.current()
        self.assertEqual(now["version_no"], before["version_no"] + 1)
        skills_now = {r[0] for r in self.conn.execute(
            "SELECT record_id FROM version_source_records WHERE version_fk = ?", (now["id"],))}
        self.assertEqual(skills_now, skills_before, "sheet skills are carried over unchanged")
        self.assertEqual([tuple(r) for r in self.conn.execute(
            "SELECT subject_code, syllabus_version, score, tier FROM version_subjects WHERE version_fk = ?", (now["id"],))],
            [(VIBE, 1, "77.00", "GOLD")])

        doc = self.pdf(now)
        data = json.loads(doc.embfile_get("passport-data.json"))
        self.assertEqual([(b["code"], b["score"], b["tier"]) for b in data["subject_badges"]], [(VIBE, "77.00", "GOLD")])
        self.assertTrue(data["subject_badges"][0]["description"])
        # after the sheet skills: a card on the skillset page and a row (with the course description) in the supplement
        skillset = doc[2].get_text()
        self.assertIn("VERIFIED AI SKILLSET", skillset)
        self.assertIn("SCORE 77.00 / 100", skillset)
        self.assertIn("GOLD SUBJECT BADGE", skillset)
        self.assertNotIn("NO CONFIRMED AI SKILLS", skillset)
        supplement = "".join(doc[i].get_text() for i in range(3, doc.page_count))
        self.assertIn("AI-ASSISTED CODING", supplement)
        self.assertIn("SCORE 77.00 / 100", supplement)
        self.assertIn(VIBE, supplement)
        cards = [ln for ln in skillset.splitlines() if ln.startswith("EARNED ") or ln.startswith("SCORE ")]
        self.assertTrue(cards[-1].startswith("SCORE"), "the subject card comes after the skill cards")

    def test_publishing_again_changes_nothing(self):
        record_marks(self.conn, ST1, VIBE, GOLD, entered_by="t")
        self.publish()
        n = self.conn.execute("SELECT COUNT(*) FROM passport_versions").fetchone()[0]
        self.assertEqual([x for x in self.publish() if x["generation"] != "not needed"], [])
        self.assertEqual(self.conn.execute("SELECT COUNT(*) FROM passport_versions").fetchone()[0], n)

    def test_a_corrected_mark_makes_the_next_version(self):
        record_marks(self.conn, ST1, VIBE, GOLD, entered_by="t")
        self.publish()
        v1 = self.current()
        record_marks(self.conn, ST1, VIBE, {"Final exam": 30, "Midterm exam": 25, "Quizzes": 15}, entered_by="t")  # 93
        self.publish()
        v2 = self.current()
        self.assertEqual(v2["version_no"], v1["version_no"] + 1)
        self.assertIn("SCORE 93.00 / 100", "".join(p.get_text() for p in self.pdf(v2)))
        self.assertIn("PLATINUM SUBJECT BADGE", "".join(p.get_text() for p in self.pdf(v2)))
        self.assertEqual(self.conn.execute("SELECT tier FROM version_subjects WHERE version_fk = ?", (v2["id"],)).fetchone()[0],
                         "PLATINUM")
        # the earlier version keeps its own badge record and its own file
        self.assertEqual(self.conn.execute("SELECT score FROM version_subjects WHERE version_fk = ?", (v1["id"],)).fetchone()[0],
                         "77.00")
        self.assertTrue((config.STORAGE_DIR / v1["pdf_storage_key"]).exists())

        # corrected below 60: no badge any more, so the next version has no subject page
        record_marks(self.conn, ST1, VIBE, {"Final exam": 0, "Midterm exam": 0, "Assignments": 0}, entered_by="t")
        self.publish()
        v3 = self.current()
        self.assertEqual(v3["version_no"], v2["version_no"] + 1)
        self.assertNotIn("SUBJECT BADGE", "".join(p.get_text() for p in self.pdf(v3)))
        self.assertNotIn("subject_badges", json.loads(self.pdf(v3).embfile_get("passport-data.json")))

    def test_unfinished_subjects_and_low_scores_give_no_badge(self):
        record_marks(self.conn, ST1, VIBE, {"Quizzes": 15}, entered_by="t")
        record_marks(self.conn, "BTU-T-0002", VIBE, {k: v / 2 for k, v in GOLD.items()}, entered_by="t")   # 38.50
        self.assertEqual(current_badges(self.conn, self.sfk), [])
        n = self.conn.execute("SELECT COUNT(*) FROM passport_versions").fetchone()[0]
        self.publish()
        self.assertEqual(self.conn.execute("SELECT COUNT(*) FROM passport_versions").fetchone()[0], n)

    def test_a_student_without_a_passport_gets_one_only_when_asked(self):
        self.conn.execute("""INSERT INTO students (student_id, first_name, last_name, email, source)
                             VALUES ('BTU-T-0901', 'Nino', 'Testadze', 'btu-t-0901@example.org', 'SEED_SYNTHETIC')""")
        record_marks(self.conn, "BTU-T-0901", VIBE, GOLD, entered_by="t")
        r = [x for x in self.publish() if x["student"] == "BTU-T-0901"]
        self.assertIn("no passport", r[0]["result"])
        self.assertIsNone(self.conn.execute("SELECT 1 FROM passports p JOIN students s ON s.id = p.student_fk "
                                            "WHERE s.student_id = 'BTU-T-0901'").fetchone())
        r = [x for x in self.publish(assign_new_passport_ids=True) if x["student"] == "BTU-T-0901"]
        self.assertEqual((r[0]["generation"], r[0]["issuance"]), ("generated", "demo"))
        p = self.conn.execute("SELECT p.* FROM passports p JOIN students s ON s.id = p.student_fk "
                              "WHERE s.student_id = 'BTU-T-0901'").fetchone()
        self.assertRegex(p["passport_id"], r"^BTU-AI-\d{6}$")
        v = self.current(p["id"])
        self.assertEqual(v["version_no"], 1)
        text = "".join(pg.get_text() for pg in self.pdf(v))
        self.assertNotIn("NO CONFIRMED AI SKILLS RECORDED YET", text, "the subject badge fills the skill pages")
        self.assertIn("SCORE 77.00 / 100", text)
        self.assertIn("AI-ASSISTED CODING", text)

    def test_an_import_without_marks_makes_no_new_versions(self):
        before = self.conn.execute("SELECT COUNT(*) FROM passport_versions").fetchone()[0]
        res = run_import(self.conn, read_workbook(WORKBOOK), _options())
        self.assertEqual(res.summary["versions_generated"], 0)
        self.assertEqual(self.conn.execute("SELECT COUNT(*) FROM passport_versions").fetchone()[0], before)

    def test_badge_records_are_append_only(self):
        record_marks(self.conn, ST1, VIBE, GOLD, entered_by="t")
        self.publish()
        for sql in ("UPDATE version_subjects SET tier = 'PLATINUM'", "DELETE FROM version_subjects",
                    "UPDATE candidate_subjects SET score = '99.00'", "DELETE FROM candidate_subjects"):
            with self.subTest(sql), self.assertRaises(sqlite3.IntegrityError):
                self.conn.execute(sql)

    def test_command_line(self):
        record_marks(self.conn, ST1, VIBE, GOLD, entered_by="t")
        self.conn.close()
        self.assertEqual(cli(["subjects", "publish"]), 0)
        self.conn = connect()
        self.assertEqual(self.conn.execute("SELECT COUNT(*) FROM version_subjects").fetchone()[0], 1)


class ArtworkTest(unittest.TestCase):
    def test_every_subject_icon_in_every_tier(self):
        from worker.pdf.render import _Fonts
        from worker.pdf.subject_badges import SUBJECT_ICONS, stamp_doc
        catalog = json.loads((Path(__file__).resolve().parents[1] / "subjects" / "catalog.json").read_text())
        used = {s["logo_key"] for s in catalog["subjects"] if s["passport_relevant"]}
        self.assertLessEqual(used, set(SUBJECT_ICONS), "every passport subject has a drawn icon")
        fonts = _Fonts()
        for key in SUBJECT_ICONS:
            for tier in ("SILVER", "GOLD", "PLATINUM"):
                with self.subTest(key=key, tier=tier):
                    page = stamp_doc(fonts, key, tier)[0]
                    self.assertIn(tier, page.get_text())
                    self.assertGreater(len(page.get_drawings()), 3)

    def test_a_tier_that_the_score_does_not_earn_is_never_printed(self):
        from datetime import date
        from worker.pdf.model import Holder, SubjectBadge, canonical_payload
        from worker.pdf.render import render_passport
        bad = SubjectBadge("SUBJ-X", "Course", "კურსი", "chip", 6, 1, "66.00", "PLATINUM")
        h = Holder("BTU-AI-000999", "Nino", "Testadze", date(2026, 9, 1), [], "CS", "Master's", [bad])
        out = TMP_ROOT / "bad.pdf"
        with self.assertRaisesRegex(ValueError, "66.00 earns SILVER, not PLATINUM"):
            render_passport(h, 1, "2026-10-25T15:00:00Z", "BTU-AAAA-BBBB-CCCC", "https://x/verify/BTU-AAAA-BBBB-CCCC",
                            canonical_payload(h, 1, "2026-10-25T15:00:00Z"), out)
        self.assertFalse(out.exists())


if __name__ == "__main__":
    unittest.main()
