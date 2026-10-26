"""Subject stage 02 tests: marks per syllabus component, corrections, subject score and badge tier.

    python3 -m unittest worker.tests.test_grades -v

Runs in temporary folders in local-demo issuance mode: no blockchain, no Google Sheet, no live data.
"""
from __future__ import annotations

import shutil
import sqlite3
import tempfile
import unittest
from decimal import Decimal
from pathlib import Path

from worker import config
from worker.__main__ import main as cli
from worker.db import connect
from worker.sources.xlsx import read_workbook
from worker.subjects import load_catalog
from worker.subjects.grades import GradeError, mark_history, record_marks, subject_results
from worker.sync import run_import
from worker.tests.test_import import WORKBOOK
from worker.tests.test_subjects import EXISTING, dump

TMP_ROOT = Path(tempfile.mkdtemp(prefix="bdp-grades-"))
ST1, ST2 = "BTU-T-0001", "BTU-T-0002"
VIBE = "SUBJ-VIBE-CODING"   # points out of 100: Quizzes 15, Assignments 20, Agent project 10, Midterm exam 25, Final exam 30
FULL = {"Quizzes": 12, "Assignments": 15, "Agent project": 8, "Midterm exam": 19, "Final exam": 23}   # 77.00


def setUpModule():
    config.ISSUANCE_MODE = "local-demo"
    config.set_data_dir(TMP_ROOT / "baseline")
    conn = connect()
    run_import(conn, read_workbook(WORKBOOK))
    load_catalog(conn)
    conn.close()


def tearDownModule():
    shutil.rmtree(TMP_ROOT, ignore_errors=True)


class GradesTest(unittest.TestCase):
    def setUp(self):
        d = TMP_ROOT / self.id().rsplit(".", 1)[-1]
        shutil.copytree(TMP_ROOT / "baseline", d)
        config.set_data_dir(d)
        self.conn = connect()

    def tearDown(self):
        self.conn.close()

    def result(self, student=ST1, subject=VIBE):
        return next((r for r in subject_results(self.conn, student) if r.subject_code == subject), None)

    def test_full_marks_give_score_and_tier(self):
        r = record_marks(self.conn, ST1, VIBE, FULL, entered_by="ops@example.org")
        self.assertEqual((len(r["added"]), r["corrected"], r["unchanged"]), (5, [], []))
        res = self.result()
        self.assertEqual((res.status, res.score, res.tier, res.syllabus_version), ("COMPLETE", Decimal("77.00"), "GOLD", 1))

    def test_tiers_from_real_marks(self):
        cases = [({**FULL, "Final exam": 13.1}, Decimal("67.10"), "SILVER"),
                 ({"Quizzes": 15, "Assignments": 20, "Agent project": 9, "Midterm exam": 23, "Final exam": 28},
                  Decimal("95.00"), "PLATINUM"),
                 ({"Quizzes": 7.5, "Assignments": 10, "Agent project": 5, "Midterm exam": 12.5, "Final exam": 15},
                  Decimal("50.00"), None)]
        for i, (marks, score, tier) in enumerate(cases):
            with self.subTest(tier):
                student = f"BTU-T-000{i + 1}"
                record_marks(self.conn, student, VIBE, marks, entered_by="t")
                res = self.result(student)
                self.assertEqual((res.score, res.tier), (score, tier))

    def test_partial_marks_are_in_progress_without_a_badge(self):
        record_marks(self.conn, ST1, VIBE, {"Quizzes": 15, "Midterm exam": 25}, entered_by="t")
        res = self.result()
        self.assertEqual((res.status, res.score, res.tier), ("IN_PROGRESS", None, None))
        self.assertEqual(res.missing, ["Assignments", "Agent project", "Final exam"])

    def test_a_correction_is_a_new_row_and_the_old_mark_stays(self):
        record_marks(self.conn, ST1, VIBE, FULL, entered_by="t")
        r = record_marks(self.conn, ST1, VIBE, {"Final exam": 28, "Quizzes": 12}, entered_by="t2", note="re-marked")
        self.assertEqual((r["added"], r["corrected"], r["unchanged"]), ([], ["Final exam"], ["Quizzes"]))
        self.assertEqual(self.result().score, Decimal("82.00"))
        finals = [h for h in mark_history(self.conn, ST1, VIBE) if h["label"] == "Final exam"]
        self.assertEqual([h["points"] for h in finals], [23, 28])
        self.assertEqual(finals[1]["supersedes_fk"], finals[0]["id"])
        self.assertEqual(self.conn.execute("SELECT COUNT(*) FROM audit_log WHERE action = 'GRADES_RECORDED'").fetchone()[0], 2)

    def test_same_marks_again_change_nothing(self):
        record_marks(self.conn, ST1, VIBE, FULL, entered_by="t")
        before = dump(self.conn, "grade_entries"), dump(self.conn, "audit_log")
        r = record_marks(self.conn, ST1, VIBE, FULL, entered_by="t")
        self.assertEqual(len(r["unchanged"]), 5)
        self.assertEqual((dump(self.conn, "grade_entries"), dump(self.conn, "audit_log")), before)

    def test_bad_input_stores_nothing(self):
        cases = [(ST1, VIBE, {**FULL, "Quizzes": 16}, "outside 0–15"),
                 (ST1, VIBE, {"Quizzes": -1}, "outside"),
                 (ST1, VIBE, {"Essay": 5}, "not in SUBJ-VIBE-CODING syllabus v1"),
                 (ST1, VIBE, {"Quizzes": "8"}, "must be a number"),
                 (ST1, VIBE, {"Quizzes": 2.345}, "more than two decimals"),
                 (ST1, VIBE, {}, "no marks"),
                 ("BTU-T-9999", VIBE, FULL, "no student"),
                 (ST1, "SUBJ-NOPE", FULL, "no subject"),
                 (ST1, "SUBJ-CALCULUS-1", {"Final exam": 10}, "does not count toward the passport")]
        for student, subject, marks, msg in cases:
            with self.subTest(msg), self.assertRaisesRegex(GradeError, msg):
                record_marks(self.conn, student, subject, marks, entered_by="t")
        with self.assertRaisesRegex(GradeError, "entered_by"):
            record_marks(self.conn, ST1, VIBE, FULL, entered_by=" ")
        self.assertEqual(self.conn.execute("SELECT COUNT(*) FROM grade_entries").fetchone()[0], 0)

    def test_students_are_kept_apart(self):
        record_marks(self.conn, ST1, VIBE, FULL, entered_by="t")
        self.assertEqual(subject_results(self.conn, ST2), [])

    def test_the_database_refuses_edits_deletes_and_out_of_range_marks(self):
        record_marks(self.conn, ST1, VIBE, FULL, entered_by="t")
        gid, comp = self.conn.execute("SELECT id, component_fk FROM grade_entries LIMIT 1").fetchone()
        student = self.conn.execute("SELECT student_fk FROM grade_entries LIMIT 1").fetchone()[0]
        ins = ("INSERT INTO grade_entries (student_fk, component_fk, points, source, entered_by, entered_at, supersedes_fk) "
               "VALUES (?, ?, ?, 'MANUAL', 't', 'now', ?)")
        for sql, params in ((f"UPDATE grade_entries SET points = 0 WHERE id = {gid}", ()),
                            (f"DELETE FROM grade_entries WHERE id = {gid}", ()),
                            (ins, (student, comp, 999, gid)),            # above the maximum
                            (ins, (student, comp, 1, None)),             # second first-mark instead of a correction
                            (ins, (student + 1, comp, 1, gid))):         # correction of someone else's mark
            with self.subTest(sql=sql, params=params), self.assertRaises(sqlite3.IntegrityError):
                self.conn.execute(sql, params)
        self.conn.execute(ins, (student, comp, 1, gid))
        with self.assertRaises(sqlite3.IntegrityError):                  # the same mark corrected twice
            self.conn.execute(ins, (student, comp, 2, gid))

    def test_existing_passport_data_is_untouched(self):
        before = {t: dump(self.conn, t) for t in EXISTING}
        record_marks(self.conn, ST1, VIBE, FULL, entered_by="t")
        record_marks(self.conn, ST1, VIBE, {"Final exam": 28}, entered_by="t")
        self.assertEqual({t: dump(self.conn, t) for t in EXISTING}, before)

    def test_command_line(self):
        self.conn.close()
        self.assertEqual(cli(["grades", "add", "--student", ST1, "--subject", VIBE, "Quizzes=12", "Assignments=15",
                              "Agent project=8", "Midterm exam=19", "Final exam=23"]), 0)
        self.assertEqual(cli(["grades", "add", "--student", ST1, "--subject", VIBE, "Quizzes=16"]), 2)
        self.assertEqual(cli(["grades", "add", "--student", ST1, "--subject", VIBE, "Quizzes"]), 2)
        self.assertEqual(cli(["grades", "show", "--student", ST1]), 0)
        self.conn = connect()
        self.assertEqual(self.result().tier, "GOLD")


if __name__ == "__main__":
    unittest.main()
