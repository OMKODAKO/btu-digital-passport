"""Live-demo watcher: polls a Google Sheet, imports new rows and prints the new students' logins.

  .venv/bin/python scripts/sheet_watch.py "<Google Sheet link>" [--every 15] [--demo-dir data-testnet]

The sheet must be shared as "Anyone with the link can view". Every few seconds the watcher downloads it as
.xlsx (Google's export URL), and when its content changed it:
  1. fills the ID columns of rows where someone typed only a name (DEMO HELPER, see fill_demo_rows),
  2. runs the normal import (python -m worker import --assign-new-passport-ids), which validates the rows,
     generates the PDF and registers it on the chain configured in <demo-dir>/demo.env,
  3. announces every new student in large type (with a test password only when PASSPORT_PASSWORD_LOGIN=1;
     otherwise the student is picked from the list on the sign-in page).
The original Google Sheet is never written to; the filled copy lives in <demo-dir>/sheet/.
"""
from __future__ import annotations

import argparse
import datetime as dt
import hashlib
import json
import os
import re
import sqlite3
import subprocess
import sys
import time
import urllib.request
from pathlib import Path

import openpyxl

ROOT = Path(__file__).resolve().parent.parent
SHEET = "Passport Skill Records"
HEADER_ROW = 4
BADGES = {"AI Skill": "BDG-AI-001", "AI Applied Skill": "BDG-AI-002", "AI Advanced Skill": "BDG-AI-003"}


def export_url(link: str) -> str:
    m = re.search(r"/spreadsheets/d/([A-Za-z0-9_-]+)", link)
    if not m:
        raise SystemExit("That doesn't look like a Google Sheets link (expected .../spreadsheets/d/<id>/...).")
    return f"https://docs.google.com/spreadsheets/d/{m.group(1)}/export?format=xlsx"


def download(url: str, dest: Path) -> bytes:
    with urllib.request.urlopen(url, timeout=30) as r:
        data = r.read()
    if not data.startswith(b"PK"):
        raise RuntimeError("Google did not return an .xlsx file. Is the sheet shared as 'Anyone with the link'?")
    dest.write_bytes(data)
    return data


def content_digest(path: Path) -> str:
    """Hash of the cell values only: Google's export bytes differ on every download even when nothing changed."""
    ws = openpyxl.load_workbook(path, data_only=True)[SHEET]
    h = hashlib.sha256()
    for row in ws.iter_rows(values_only=True):
        h.update(repr(row).encode())
    return h.hexdigest()


def fill_demo_rows(path: Path, db_path: Path | None = None) -> list[str]:
    """DEMO HELPER: a row with a First and Last Name but no Student ID gets the next BTU-T number, a test
    email (unless one was typed), a Record ID, today's date and (if left empty) the AI Literacy skill.
    A skill named like one already in the sheet takes that skill's ID, category and description, so one
    Skill ID never gets two definitions. If the skill on a row changes after it was issued, the row gets a new
    Record ID: the new skill is added in the next version (issued skills are never rewritten).
    Rows that already have a Student ID are left exactly as BTU typed them."""
    wb = openpyxl.load_workbook(path)
    ws = wb[SHEET]
    head = {str(c.value).strip(): c.column for c in ws[HEADER_ROW] if c.value}
    col = lambda name: head[name]
    rows = list(range(HEADER_ROW + 1, ws.max_row + 1))
    val = lambda r, name: ws.cell(r, col(name)).value

    nums = [int(m.group(1)) for r in rows if (m := re.fullmatch(r"BTU-T-(\d+)", str(val(r, "Student ID") or "")))]
    recs = [int(m.group(1)) for r in rows if (m := re.fullmatch(r"REC-(\d+)", str(val(r, "Record ID") or "")))]
    db = sqlite3.connect(db_path) if db_path and db_path.exists() else None
    awards = {}   # record_id -> (student_id, skill_name)
    if db:
        awards = {rec: (sid, name) for rec, sid, name in db.execute(
            "SELECT a.record_id, s.student_id, a.skill_name FROM skill_awards a JOIN students s ON s.id = a.student_fk")}
    skills = {}
    for r in rows:
        name = val(r, "Skill Name")
        rec = val(r, "Record ID")
        if rec in awards and awards[rec][1] != str(name or "").strip():
            continue  # this row's skill was just edited; its Skill ID still belongs to the old skill
        if name and val(r, "Skill ID") and val(r, "Student ID") and name not in skills:
            skills[name] = {k: val(r, k) for k in ("Skill ID", "Skill Category", "Skill Description")}
    used = set(recs) | {int(m.group(1)) for k in awards if (m := re.fullmatch(r"REC-(\d+)", k))}
    by_email = {}  # email -> Student ID already in the system: one person, one Student ID
    if db:
        by_email = {e.lower(): sid for e, sid in db.execute("SELECT email, student_id FROM students")}
        nums += [int(m.group(1)) for sid in by_email.values() if (m := re.fullmatch(r"BTU-T-(\d+)", sid))]
    seen_people = {}
    assigned = {}  # rows of the same person in this sheet share one Student ID
    profile = {}   # Student ID -> program/level/status from that person's first row, for their other rows
    PROFILE = ("Program", "Education Level", "Student Status")
    if db:
        for sid, *vals in db.execute("SELECT student_id, program, education_level, student_status FROM students"):
            profile[sid] = dict(zip(PROFILE, vals))

    filled = []
    taken = set(recs)  # Record IDs on rows of this sheet, plus those handed out below
    sheet_recs = [val(r, "Record ID") for r in rows]
    seen_recs = set()
    for r in rows:
        sid, rec = val(r, "Student ID"), val(r, "Record ID")
        if not sid:
            continue
        set_ = lambda name, v, r=r: ws.cell(r, col(name), v)
        skill = str(val(r, "Skill Name") or "").strip()
        # a skill's ID, category and description are the same on every row (otherwise every row of it is refused)
        if skill in skills and any(str(val(r, k) or "").strip() != str(v or "").strip() for k, v in skills[skill].items()):
            for k, v in skills[skill].items():
                set_(k, v)
            set_("Badge/Stamp Code", BADGES.get(val(r, "Skill Category"), "CHECK CATEGORY"))
            filled.append(f"{val(r, 'First Name')} {val(r, 'Last Name')} ({sid}): {skill} uses the sheet's definition")
        # a copied row keeps the original's Record ID: give the copy its own (the import refuses duplicates)
        if rec and rec in seen_recs:
            free = [k for k, v in awards.items() if v == (sid, skill) and k not in sheet_recs]
            if free:
                new_rec = free[0]
            else:
                n = max(used | taken) + 1
                used.add(n)
                taken.add(n)
                new_rec = f"REC-{n:04d}"
            set_("Record ID", new_rec)
            filled.append(f"{val(r, 'First Name')} {val(r, 'Last Name')} ({sid}): copied row -> new Record ID {new_rec}")
        elif rec:
            seen_recs.add(rec)
    for r in rows:
        rec, sid, skill = val(r, "Record ID"), val(r, "Student ID"), str(val(r, "Skill Name") or "").strip()
        if not (rec and sid and skill) or rec not in awards or awards[rec] == (sid, skill):
            continue
        if awards[rec][0] != sid:
            continue  # a Record ID that belongs to someone else is for the import to report, not to fix here
        set_ = lambda name, v, r=r: ws.cell(r, col(name), v)
        if skill in skills:
            for k, v in skills[skill].items():
                set_(k, v)
        set_("Badge/Stamp Code", BADGES.get(val(r, "Skill Category"), "CHECK CATEGORY"))
        same = [k for k, v in awards.items() if v == (sid, skill)]
        if same:
            new_rec = same[0]
        else:
            n = max(used | taken) + 1
            used.add(n)
            taken.add(n)
            new_rec = f"REC-{n:04d}"
        set_("Record ID", new_rec)
        filled.append(f"{val(r, 'First Name')} {val(r, 'Last Name')} ({sid}): skill changed to {skill} -> {new_rec}")
    next_id, next_rec = max(nums, default=0) + 1, max(recs, default=0) + 1
    sheet_ids = {str(val(r, "BTU Email (Test)") or "").strip().lower(): val(r, "Student ID") for r in rows
                 if val(r, "Student ID") and val(r, "BTU Email (Test)")}
    for r in rows:
        first, last = val(r, "First Name"), val(r, "Last Name")
        if not (first and last) or val(r, "Student ID"):
            continue
        email = str(val(r, "BTU Email (Test)") or "").strip().lower()
        key = email or f"{first} {last}".strip().lower()
        sid = assigned.get(key) or sheet_ids.get(email) or by_email.get(email)
        if not sid:
            sid = f"BTU-T-{next_id:04d}"
            next_id += 1
        assigned[key] = sid
        set_ = lambda name, v: ws.cell(r, col(name), v)
        set_("Student ID", sid)
        set_("BTU Email (Test)", val(r, "BTU Email (Test)") or f"{sid.lower()}@example.org")
        if key in seen_people:  # a further row of the same person: blanks follow their first row
            known = profile.get(sid, {})
        else:
            known, seen_people[key] = {}, True
        for f, default in zip(PROFILE, ("Hackathon Jury Demo", "Bachelor's", "Active")):
            set_(f, val(r, f) or known.get(f) or default)
        profile[sid] = {f: val(r, f) for f in PROFILE}
        skill = str(val(r, "Skill Name") or "AI Literacy").strip()
        set_("Skill Name", skill)
        note = ""
        if skill in skills:
            for k, v in skills[skill].items():
                if val(r, k) and str(val(r, k)).strip() != str(v).strip():
                    note += f" ({k} set to the catalog's '{v}')"
                set_(k, v)
        else:  # a skill not in the sheet yet: give it its own ID; category must be one of the three
            set_("Skill ID", "SKL-D" + hashlib.sha1(skill.lower().encode()).hexdigest()[:5].upper())
            if val(r, "Skill Category") not in BADGES:
                set_("Skill Category", "AI Skill")
            set_("Skill Description", val(r, "Skill Description") or skill)
        rec = f"REC-{next_rec:04d}"
        same = [k for k, v in awards.items() if v == (sid, skill)]
        if same:  # this person already holds this skill under a Record ID: keep using it
            rec = same[0]
        elif rec in awards or next_rec in taken:  # the next number is someone else's: take a free one
            n = max(used | taken) + 1
            rec = f"REC-{n:04d}"
            note += f" (new record {rec})"
        taken.add(int(rec[4:]))
        used.add(int(rec[4:]))
        set_("Record ID", rec)
        set_("Badge/Stamp Code", BADGES.get(val(r, "Skill Category"), "CHECK CATEGORY"))
        set_("Date Earned", val(r, "Date Earned") or dt.date.today().isoformat())
        filled.append(f"{first} {last} -> {sid}{note}")
        next_rec += 1
    if filled:
        wb.save(path)
    return filled


FIELDS = ["Student ID", "First Name", "Last Name", "BTU Email (Test)", "Program", "Education Level",
          "Student Status", "Skill Name", "Skill Category", "Skill Description", "Date Earned"]


def _text(v) -> str:
    """Cell value as text; Google Sheets turns typed dates into date cells, which must compare equal."""
    if isinstance(v, dt.datetime):
        return v.date().isoformat() if v.time() == dt.time() else v.isoformat(sep=" ")
    if isinstance(v, dt.date):
        return v.isoformat()
    return "" if v is None else str(v)


def snapshot(path: Path) -> dict:
    """Record ID -> the fields above, as filled (so edits can be described)."""
    ws = openpyxl.load_workbook(path, data_only=True)[SHEET]
    head = {str(c.value).strip(): c.column for c in ws[HEADER_ROW] if c.value}
    out = {}
    for r in range(HEADER_ROW + 1, ws.max_row + 1):
        rec = ws.cell(r, head["Record ID"]).value
        if rec and ws.cell(r, head["Student ID"]).value:
            out[str(rec)] = {f: _text(ws.cell(r, head[f]).value) for f in FIELDS if f in head}
    return out


def describe_edits(old: dict, new: dict) -> list[str]:
    lines = []
    for rec, row in new.items():
        before = old.get(rec)
        if not before:
            continue
        diff = [f"{f}: '{before.get(f, '')}' -> '{v}'" + (" (not applied: the name on a passport is fixed)"
                if f in ("First Name", "Last Name") else
                " (not applied: an issued skill is not rewritten; add it as a new row)"
                if f.startswith("Skill") or f == "Date Earned" else "")
                for f, v in row.items() if before.get(f, "") != v]
        if diff:
            lines.append(f"{row['First Name']} {row['Last Name']} ({row['Student ID']}, {rec}): " + "; ".join(diff))
    return lines


PROFILE_LABELS = {"BTU Email (Test)": "Email", "Program": "Program", "Education Level": "Education level"}


def profile_edits(old: dict, new: dict) -> dict:
    """Student ID -> ["Program: A -> B", ...] for the profile fields an edit changes (one entry per field)."""
    out = {}
    for rec, row in new.items():
        before = old.get(rec)
        if not before:
            continue
        for f, label in PROFILE_LABELS.items():
            if before.get(f, "") != row.get(f, ""):
                line = f"{label}: {before.get(f) or '-'} -> {row.get(f) or '-'}"
                if line not in out.setdefault(row["Student ID"], []):
                    out[row["Student ID"]].append(line)
    return out


def version_skills(db, student_fk: int, version_no: int) -> list[str]:
    return [n for (n,) in db.execute(
        """SELECT a.skill_name FROM passports p JOIN passport_versions v ON v.passport_fk = p.id AND v.version_no = ?
           JOIN version_source_records x ON x.version_fk = v.id JOIN skill_awards a ON a.record_id = x.record_id
           WHERE p.student_fk = ? ORDER BY a.date_earned, a.record_id""", (version_no, student_fk))]


def update_banner(name: str, old_ver: int, ver: int, changes: list[str], skills: list[str]) -> None:
    bar = "=" * 64
    print(f"\n\033[1;33m{bar}\n  PASSPORT UPDATED: {name}  (V{old_ver} -> V{ver})\n{bar}\033[0m")
    for c in changes or ["(no visible change)"]:
        print(f"  {c}")
    print(f"  Skills in V{ver}: {', '.join(skills)}")
    print(f"\033[1;33m{bar}\033[0m\n", flush=True)
    if sys.platform == "darwin":
        msg = (f"{name}: V{old_ver} -> V{ver}\n\nWhat changed:\n" + "\n".join(f"• {c}" for c in changes or ["-"])
               + f"\n\nSkills in V{ver}:\n" + "\n".join(f"• {k}" for k in skills)).replace('"', "'")
        subprocess.Popen(["osascript", "-e",
                          f'display dialog "{msg}" with title "Passport updated" buttons {{"OK"}} default button 1'],
                         stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)


def current_versions(demo_dir: Path) -> dict:
    db = sqlite3.connect(demo_dir / "portal.db")
    return dict(db.execute(
        """SELECT p.student_fk, MAX(v.version_no) FROM passports p JOIN passport_versions v ON v.passport_fk = p.id
           WHERE v.status = 'CURRENT' GROUP BY p.student_fk"""))


def sync_credential_emails(demo_dir: Path) -> None:
    """After an email edit the login moves to the new address; keep dev-credentials.txt in step."""
    db = sqlite3.connect(demo_dir / "portal.db")
    f = demo_dir / "dev-credentials.txt"
    lines = f.read_text().splitlines()
    known = {e.lower() for (e,) in db.execute("SELECT email FROM students")}
    # an address no longer in the system was changed; nothing else identifies it, so only fix single renames
    stale = [l for l in lines if l.split("\t")[0].lower() not in known]
    missing = [e for (e,) in db.execute(
        "SELECT s.email FROM students s JOIN auth_credentials a ON a.student_fk = s.id")
        if e.lower() not in {l.split("\t")[0].lower() for l in lines}]
    if len(stale) == 1 and len(missing) == 1:
        lines = [f"{missing[0]}\t{l.split(chr(9))[1]}" if l is stale[0] else l for l in lines]
        f.write_text("\n".join(lines) + "\n")


def stamp_official(synced: Path, db_path: Path) -> None:
    """Fill what the system knows into the processed copy, like the other rows: Passport ID and First Issued
    for every student with a passport, and Q–R (SYNCED, version) for every row in their current version."""
    db = sqlite3.connect(db_path)
    passports = {sid: (pid, first) for sid, pid, first in db.execute(
        "SELECT s.student_id, p.passport_id, p.first_issued_on FROM passports p JOIN students s ON s.id = p.student_fk")}
    current = {rec: (sid, ver) for rec, sid, ver in db.execute(
        """SELECT x.record_id, s.student_id, v.version_no FROM passports p JOIN students s ON s.id = p.student_fk
           JOIN passport_versions v ON v.passport_fk = p.id AND v.status = 'CURRENT'
           JOIN version_source_records x ON x.version_fk = v.id""")}
    wb = openpyxl.load_workbook(synced)
    ws = wb[SHEET]
    head = {str(c.value).strip(): c.column for c in ws[HEADER_ROW] if c.value}
    now = time.strftime("%Y-%m-%d %H:%M UTC", time.gmtime())
    for r in range(HEADER_ROW + 1, ws.max_row + 1):
        sid, rec = ws.cell(r, head["Student ID"]).value, ws.cell(r, head["Record ID"]).value
        if sid in passports:
            for name, v in zip(("Passport ID (Existing)", "First Issued (Existing)"), passports[sid]):
                if not ws.cell(r, head[name]).value:
                    ws.cell(r, head[name], v)
        if rec in current and current[rec][0] == sid:
            ver = f"V{current[rec][1]}"
            if ws.cell(r, head["Synced Passport Version"]).value != ver:
                ws.cell(r, head["Passport Sync Status"], "SYNCED")
                ws.cell(r, head["Synced Passport Version"], ver)
                ws.cell(r, head["Synced At (UTC)"], now)
    wb.save(synced)


def sheet_changes(downloaded: Path, synced: Path) -> list[dict]:
    """Cells (A–T) where the processed copy differs from the Google Sheet: the values to write back."""
    a = openpyxl.load_workbook(downloaded)[SHEET]
    b = openpyxl.load_workbook(synced)[SHEET]
    out = []
    for r in range(HEADER_ROW + 1, b.max_row + 1):
        for c in range(1, 21):
            old, new = a.cell(r, c).value, b.cell(r, c).value
            norm = lambda v: v.date().isoformat() if isinstance(v, dt.datetime) else (
                v.isoformat() if isinstance(v, dt.date) else ("" if v is None else str(v)))
            if norm(old) != norm(new) and not (isinstance(old, str) and old.startswith("=")):
                out.append({"row": r, "col": c, "value": norm(new)})
    return out


def write_back(url: str, token: str, cells: list[dict]) -> str:
    req = urllib.request.Request(url, data=json.dumps({"token": token, "cells": cells}).encode(),
                                 headers={"Content-Type": "application/json"}, method="POST")
    with urllib.request.urlopen(req, timeout=60) as r:  # Apps Script answers through a redirect
        return r.read().decode()[:200]


def demo_env_file(path: Path) -> dict:
    out = {}
    if path.exists():
        for line in path.read_text().splitlines():
            if "=" in line and not line.lstrip().startswith("#"):
                k, v = line.split("=", 1)
                out[k.strip()] = v.strip().strip('"')
    return out


def demo_env(demo_dir: Path) -> dict:
    env = dict(os.environ)
    for line in (demo_dir / "demo.env").read_text().splitlines():
        if "=" in line and not line.lstrip().startswith("#"):
            k, v = line.split("=", 1)
            env[k.strip()] = v.strip().strip('"')
    env["PATH"] = f"{ROOT / '.venv' / 'bin'}:{env.get('PATH', '')}"
    return env


def new_logins(demo_dir: Path, env: dict) -> list[tuple[str, str, str]]:
    db = sqlite3.connect(demo_dir / "portal.db")
    missing = db.execute(
        "SELECT s.email, s.first_name || ' ' || s.last_name FROM students s "
        "JOIN passports p ON p.student_fk = s.id "
        "WHERE s.id NOT IN (SELECT student_fk FROM auth_credentials)").fetchall()
    out = []
    for email, name in missing:
        subprocess.run(["npx", "tsx", "scripts/create-login.ts", email], cwd=ROOT, env=env, check=True,
                       stdout=subprocess.DEVNULL)
        creds = (demo_dir / "dev-credentials.txt").read_text().splitlines()
        pw = next(l.split("\t")[1] for l in reversed(creds) if l.startswith(email + "\t"))
        out.append((name, email, pw))
    return out


def banner(name: str, email: str, pw: str, port: str, title: str = "NEW PASSPORT READY") -> None:
    bar = "=" * 64
    print(f"\n\033[1;32m{bar}\n  {title}: {name}\n{bar}\033[0m")
    print(f"  Open:      http://localhost:{port}/login")
    print(f"  Email:     \033[1m{email}\033[0m")
    # passwords are off unless PASSPORT_PASSWORD_LOGIN=1: the student is picked from the list on the sign-in page
    sign_in = f"Password: {pw}" if os.environ.get("PASSPORT_PASSWORD_LOGIN") == "1" else f"Sign in: choose {name} from the list"
    print(f"  {sign_in}")
    print(f"\033[1;32m{bar}\033[0m\n", flush=True)
    if sys.platform == "darwin":  # a popup on screen too, so the presenter sees it without the terminal
        msg = f"{name}\n\nhttp://localhost:{port}/login\nEmail: {email}\n{sign_in}".replace('"', "'")
        subprocess.Popen(["osascript", "-e",
                          f'display dialog "{msg}" with title "{title.capitalize()}" buttons {{"OK"}} default button 1'],
                         stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("link")
    ap.add_argument("--every", type=float, default=15)
    ap.add_argument("--demo-dir", default="data-testnet")
    a = ap.parse_args()
    demo_dir = (ROOT / a.demo_dir).resolve()
    env = demo_env(demo_dir)
    url = export_url(a.link)
    work = demo_dir / "sheet"
    work.mkdir(exist_ok=True)
    last, seen = None, None
    prev = snapshot(work / "latest.xlsx") if (work / "latest.xlsx").exists() else {}
    print(f"Watching the Google Sheet every {a.every:g}s (Ctrl-C to stop). Chain: {env.get('PASSPORT_CHAIN_NETWORK')}", flush=True)
    while True:
        try:
            raw = download(url, work / "downloaded.xlsx")
            digest = content_digest(work / "downloaded.xlsx")
            # Import only once the sheet has stopped changing for one interval, so a row someone is still
            # typing (name first, then email, program ...) is not imported half-filled.
            stable, seen = digest == seen, digest
            if digest != last and not stable:
                print(f"[{time.strftime('%H:%M:%S')}] sheet changed, waiting until editing stops ...", flush=True)
            if digest != last and stable:
                last = digest
                copy = work / "latest.xlsx"
                copy.write_bytes(raw)
                for f in fill_demo_rows(copy, demo_dir / "portal.db"):
                    print(f"  filled demo row: {f}", flush=True)
                print(f"[{time.strftime('%H:%M:%S')}] sheet changed, importing ...", flush=True)
                snap = snapshot(copy)
                for line in describe_edits(prev, snap):
                    print(f"  \033[1;33mEDIT\033[0m {line}", flush=True)
                edits = profile_edits(prev, snap)
                prev = snap
                before = current_versions(demo_dir)
                synced = work / "synced.xlsx"
                r = subprocess.run([sys.executable, "-m", "worker", "import", "--xlsx", str(copy),
                                    "--assign-new-passport-ids", "--apply-edits", "--output", str(synced)],
                                   cwd=ROOT, env=env, capture_output=True, text=True)
                for line in r.stdout.splitlines():
                    if any(w in line for w in ("passports created", "issuance", "ERROR", "HOLD")):
                        print("  " + line.strip(), flush=True)
                if r.returncode != 0:
                    print(r.stderr[-1500:], flush=True)
                writer = demo_env_file(demo_dir / "sheet-writer.env")
                if r.returncode == 0 and writer.get("SHEET_WRITER_URL") and synced.exists():
                    stamp_official(synced, demo_dir / "portal.db")
                    cells = sheet_changes(work / "downloaded.xlsx", synced)
                    if cells:
                        rows_ = sorted({c["row"] for c in cells})
                        print(f"  writing {len(cells)} cell(s) back to the Google Sheet (rows {', '.join(map(str, rows_))}): "
                              + write_back(writer["SHEET_WRITER_URL"], writer["SHEET_WRITER_TOKEN"], cells), flush=True)
                sync_credential_emails(demo_dir)
                for name, email, pw in new_logins(demo_dir, env):
                    banner(name, email, pw, os.environ.get("PORT", "3000"))
                after = current_versions(demo_dir)
                db = sqlite3.connect(demo_dir / "portal.db")
                for fk, ver in after.items():
                    if fk in before and ver > before[fk]:
                        name, sid = db.execute("SELECT first_name || ' ' || last_name, student_id FROM students WHERE id = ?",
                                               (fk,)).fetchone()
                        old_sk, new_sk = version_skills(db, fk, before[fk]), version_skills(db, fk, ver)
                        changes = list(edits.get(sid, []))
                        changes += [f"Skill added: {k}" for k in new_sk if k not in old_sk]
                        changes += [f"Skill removed: {k}" for k in old_sk if k not in new_sk]
                        update_banner(name, before[fk], ver, changes, new_sk)
        except Exception as e:  # keep watching through network hiccups
            print(f"[{time.strftime('%H:%M:%S')}] {e}", flush=True)
        time.sleep(a.every)


if __name__ == "__main__":
    main()
