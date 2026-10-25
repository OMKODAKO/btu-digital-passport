"""Subject stage 01 tests: subject catalog, simulated syllabi, weighted score and badge tiers.

    python3 -m unittest worker.tests.test_subjects -v

Runs in temporary folders in local-demo issuance mode: no blockchain, no Google Sheet, no live data.
"""
from __future__ import annotations

import copy
import shutil
import sqlite3
import tempfile
import unittest
from decimal import Decimal
from pathlib import Path

from worker import config
from worker.db import connect
from worker.sources.xlsx import read_workbook
from worker.subjects import (CatalogError, load_catalog, passport_subjects, read_catalog, syllabus_components,
                             validate_catalog)
from worker.subjects.scoring import ScoreError, subject_score, tier_for
from worker.sync import run_import
from worker.tests.test_import import WORKBOOK

TMP_ROOT = Path(tempfile.mkdtemp(prefix="bdp-subjects-"))
EXISTING = ["students", "auth_credentials", "passports", "passport_versions", "version_candidates", "candidate_records",
            "version_source_records", "skill_awards", "catalog_skills", "source_records", "import_runs", "row_issues",
            "staff", "retry_requests"]


def setUpModule():
    config.ISSUANCE_MODE = "local-demo"


def tearDownModule():
    shutil.rmtree(TMP_ROOT, ignore_errors=True)


def fresh(name: str):
    config.set_data_dir(TMP_ROOT / name)
    return connect()


def dump(conn, table: str) -> list[tuple]:
    return [tuple(r) for r in conn.execute(f"SELECT * FROM {table} ORDER BY rowid")]


class MigrationTests(unittest.TestCase):
    def test_new_migrations_keep_existing_data_exactly(self):
        """A database made before 006 (with imported passports) gains the new tables and nothing else changes."""
        old_dir = TMP_ROOT / "migrations-005"
        old_dir.mkdir()
        for f in sorted(config.MIGRATIONS_DIR.glob("00[1-5]_*.sql")):
            shutil.copy(f, old_dir)
        real = config.MIGRATIONS_DIR
        try:
            config.MIGRATIONS_DIR = old_dir
            conn = fresh("before-006")
            run_import(conn, read_workbook(WORKBOOK))
            before = {t: dump(conn, t) for t in EXISTING}
            self.assertTrue(before["passport_versions"])
            self.assertIsNone(conn.execute("SELECT 1 FROM sqlite_master WHERE name = 'subjects'").fetchone())
            conn.close()
        finally:
            config.MIGRATIONS_DIR = real
        conn = connect()  # same data folder, all migrations: applies 006 onward
        self.assertEqual({t: dump(conn, t) for t in EXISTING}, before)
        self.assertEqual(conn.execute("SELECT MAX(version) FROM schema_migrations").fetchone()[0], "007")
        for t in ("subjects", "syllabi", "syllabus_components", "grade_entries"):
            self.assertEqual(conn.execute(f"SELECT COUNT(*) FROM {t}").fetchone()[0], 0)


class CatalogTests(unittest.TestCase):
    def setUp(self):
        self.data = read_catalog()

    def test_catalog_is_valid(self):
        self.assertEqual(validate_catalog(self.data), [])
        self.assertEqual(len(self.data["subjects"]), 29)

    def test_every_syllabus_adds_up_to_100(self):
        for s in self.data["subjects"]:
            self.assertEqual(sum(c["weight"] for c in s["syllabus"]), 100, s["code"])

    def test_passport_subjects_are_the_13_ai_relevant_ones(self):
        relevant = {s["name_en"] for s in self.data["subjects"] if s["passport_relevant"]}
        self.assertEqual(len(relevant), 13)
        self.assertIn("Vibe Coding and AI-Agentic Engineering", relevant)
        self.assertIn("Artificial Intelligence and Machine Learning", relevant)
        self.assertNotIn("Practical English (B1)", relevant)

    def test_bad_catalogs_are_refused(self):
        cases = {
            "weights add up to": lambda d: d["subjects"][0]["syllabus"].pop(),
            "kind must be one of": lambda d: d["subjects"][0]["syllabus"][0].update(kind="ESSAY"),
            "max_points must be above 0": lambda d: d["subjects"][0]["syllabus"][0].update(max_points=0),
            "must equal its weight": lambda d: d["subjects"][0]["syllabus"][0].update(max_points=20),
            "code used twice": lambda d: d["subjects"][1].update(code=d["subjects"][0]["code"]),
            "used twice": lambda d: d["subjects"][1].update(name_ka=d["subjects"][0]["name_ka"]),
            "credits must be": lambda d: d["subjects"][0].update(credits=0),
            "needs a skill_area": lambda d: d["subjects"][0].update(skill_area=None),
            "label twice": lambda d: d["subjects"][0]["syllabus"][1].update(label=d["subjects"][0]["syllabus"][0]["label"]),
        }
        for expected, break_it in cases.items():
            with self.subTest(expected):
                bad = copy.deepcopy(self.data)
                break_it(bad)
                problems = validate_catalog(bad)
                self.assertTrue(any(expected in p for p in problems), problems)
                conn = fresh("bad-" + expected.replace(" ", "-"))
                with self.assertRaises(CatalogError):
                    load_catalog(conn, bad)
                self.assertEqual(conn.execute("SELECT COUNT(*) FROM subjects").fetchone()[0], 0)


class LoadTests(unittest.TestCase):
    def test_load_adds_every_subject_with_a_simulated_syllabus(self):
        conn = fresh("load")
        r = load_catalog(conn)
        self.assertEqual((len(r.subjects_added), len(r.syllabi_added), r.differences), (29, 29, []))
        self.assertEqual(len(passport_subjects(conn)), 13)
        vibe = conn.execute("SELECT * FROM subjects WHERE code = 'SUBJ-VIBE-CODING'").fetchone()
        self.assertEqual((vibe["credits"], vibe["passport_relevant"], vibe["skill_area"]), (3, 1, "AI & ML"))
        comps = syllabus_components(conn, vibe["id"])
        self.assertEqual([c["kind"] for c in comps], ["QUIZ", "ASSIGNMENT", "PROJECT", "MIDTERM", "FINAL"])
        self.assertEqual(sum(c["weight"] for c in comps), 100)
        self.assertEqual(conn.execute("SELECT COUNT(*) FROM syllabi WHERE simulated = 0").fetchone()[0], 0)
        self.assertEqual(conn.execute("SELECT COUNT(*) FROM audit_log WHERE action = 'SUBJECT_CATALOG_LOADED'").fetchone()[0], 1)

    def test_loading_twice_changes_nothing(self):
        conn = fresh("twice")
        load_catalog(conn)
        before = {t: dump(conn, t) for t in ("subjects", "syllabi", "syllabus_components", "audit_log")}
        r = load_catalog(conn)
        self.assertEqual((r.subjects_added, r.syllabi_added, r.unchanged, r.differences), ([], [], 29, []))
        self.assertEqual({t: dump(conn, t) for t in before}, before)

    def test_catalog_changes_never_overwrite_the_database(self):
        conn = fresh("changed")
        load_catalog(conn)
        before = {t: dump(conn, t) for t in ("subjects", "syllabi", "syllabus_components")}
        changed = read_catalog()
        changed["subjects"][0]["credits"] = 9
        changed["subjects"][0]["syllabus"][0]["label"] = "Short quizzes"
        r = load_catalog(conn, changed)
        self.assertEqual(len(r.differences), 1, r.differences)          # credits: reported, not applied
        self.assertEqual(r.syllabi_added, ["SUBJ-VIBE-CODING v2"])    # syllabus: added as a new version
        after = {t: dump(conn, t) for t in before}
        for t in before:
            self.assertEqual(after[t][:len(before[t])], before[t], t)  # every earlier row exactly as it was
        self.assertEqual(len(after["syllabi"]), len(before["syllabi"]) + 1)
        vibe = conn.execute("SELECT id FROM subjects WHERE code = 'SUBJ-VIBE-CODING'").fetchone()[0]
        self.assertEqual([c["label"] for c in syllabus_components(conn, vibe)][0], "Short quizzes")
        again = load_catalog(conn, changed)
        self.assertEqual((again.syllabi_added, again.unchanged), ([], 29))

    def test_every_component_is_worth_its_weight_in_points(self):
        for s in read_catalog()["subjects"]:
            self.assertEqual(sum(c["max_points"] for c in s["syllabus"]), 100, s["code"])
            self.assertTrue(all(c["max_points"] == c["weight"] for c in s["syllabus"]), s["code"])

    def test_syllabi_and_subjects_are_append_only(self):
        conn = fresh("frozen")
        load_catalog(conn)
        for sql in ("UPDATE syllabus_components SET weight = 50 WHERE id = 1",
                    "DELETE FROM syllabus_components WHERE id = 1",
                    "UPDATE syllabi SET simulated = 0 WHERE id = 1",
                    "DELETE FROM syllabi WHERE id = 1",
                    "DELETE FROM subjects WHERE id = 1"):
            with self.subTest(sql), self.assertRaises(sqlite3.IntegrityError):
                conn.execute(sql)

    def test_existing_passport_data_is_untouched_by_loading(self):
        conn = fresh("with-passports")
        run_import(conn, read_workbook(WORKBOOK))
        before = {t: dump(conn, t) for t in EXISTING}
        load_catalog(conn)
        self.assertEqual({t: dump(conn, t) for t in EXISTING}, before)


class ScoringTests(unittest.TestCase):
    COMPONENTS = [  # the Vibe Coding simulated syllabus
        {"label": "Quizzes", "weight": 10, "max_points": 20},
        {"label": "Assignments", "weight": 20, "max_points": 40},
        {"label": "Agent project", "weight": 30, "max_points": 100},
        {"label": "Midterm exam", "weight": 15, "max_points": 30},
        {"label": "Final exam", "weight": 25, "max_points": 50},
    ]

    def score(self, q, a, p, m, f):
        return subject_score(self.COMPONENTS, {"Quizzes": q, "Assignments": a, "Agent project": p,
                                               "Midterm exam": m, "Final exam": f})

    def test_weighted_score(self):
        self.assertEqual(self.score(20, 40, 100, 30, 50), Decimal("100.00"))
        self.assertEqual(self.score(0, 0, 0, 0, 0), Decimal("0.00"))
        # 15/20*10 + 30/40*20 + 80/100*30 + 21/30*15 + 40/50*25 = 7.5 + 15 + 24 + 10.5 + 20
        self.assertEqual(self.score(15, 30, 80, 21, 40), Decimal("77.00"))
        # raw points are NOT summed: the project's 100 raw points count only 30
        self.assertEqual(self.score(0, 0, 100, 0, 0), Decimal("30.00"))

    def test_rounding_is_half_up_to_two_decimals(self):
        comps = [{"label": "Final exam", "weight": 100, "max_points": 3}]
        self.assertEqual(subject_score(comps, {"Final exam": 2}), Decimal("66.67"))
        self.assertEqual(subject_score(comps, {"Final exam": 1}), Decimal("33.33"))

    def test_bad_marks_are_refused(self):
        for earned, msg in (({"Quizzes": 21}, "outside"), ({"Quizzes": -1}, "outside"),
                            ({"Quizzes": 10, "Essay": 5}, "not in this syllabus")):
            with self.subTest(earned), self.assertRaisesRegex(ScoreError, msg):
                full = {"Quizzes": 0, "Assignments": 0, "Agent project": 0, "Midterm exam": 0, "Final exam": 0}
                subject_score(self.COMPONENTS, {**full, **earned})
        with self.assertRaisesRegex(ScoreError, "no mark for Final exam"):
            subject_score(self.COMPONENTS, {"Quizzes": 1, "Assignments": 1, "Agent project": 1, "Midterm exam": 1})

    def test_tier_boundaries(self):
        cases = [(0, None), (59.99, None), (60, "SILVER"), (69.99, "SILVER"), (70, "GOLD"), (89.99, "GOLD"),
                 (90, "PLATINUM"), (100, "PLATINUM")]
        for score, tier in cases:
            with self.subTest(score):
                self.assertEqual(tier_for(score), tier)
        for bad in (-0.01, 100.01):
            with self.assertRaises(ScoreError):
                tier_for(bad)

    def test_score_and_tier_agree_at_a_rounded_boundary(self):
        comps = [{"label": "Final exam", "weight": 100, "max_points": 1000}]
        s = subject_score(comps, {"Final exam": 899.96})   # 89.996 -> 90.00
        self.assertEqual((s, tier_for(s)), (Decimal("90.00"), "PLATINUM"))


if __name__ == "__main__":
    unittest.main()
