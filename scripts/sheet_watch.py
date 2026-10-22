"""Live-demo watcher: polls a Google Sheet, imports new rows and prints the new students' logins.

  .venv/bin/python scripts/sheet_watch.py "<Google Sheet link>" [--every 15] [--demo-dir data-testnet]

The sheet must be shared as "Anyone with the link can view". Every few seconds the watcher downloads it as
.xlsx (Google's export URL), and when its content changed it:
  1. fills the ID columns of rows where someone typed only a name (DEMO HELPER, see fill_demo_rows),
  2. runs the normal import (python -m worker import --assign-new-passport-ids), which validates the rows,
     generates the PDF and registers it on the chain configured in <demo-dir>/demo.env,
  3. creates a login for every student who has none yet and prints email + password in large type.
The original Google Sheet is never written to; the filled copy lives in <demo-dir>/sheet/.
"""
from __future__ import annotations

import argparse
import datetime as dt
import hashlib
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


def fill_demo_rows(path: Path) -> list[str]:
    """DEMO HELPER: a row with a First and Last Name but no Student ID gets the next BTU-T number, a test
    email, a Record ID, today's date and (if left empty) the AI Literacy skill copied from an existing row.
    Rows that already have a Student ID are left exactly as BTU typed them."""
    wb = openpyxl.load_workbook(path)
    ws = wb[SHEET]
    head = {str(c.value).strip(): c.column for c in ws[HEADER_ROW] if c.value}
    col = lambda name: head[name]
    rows = list(range(HEADER_ROW + 1, ws.max_row + 1))
    val = lambda r, name: ws.cell(r, col(name)).value

    nums = [int(m.group(1)) for r in rows if (m := re.fullmatch(r"BTU-T-(\d+)", str(val(r, "Student ID") or "")))]
    recs = [int(m.group(1)) for r in rows if (m := re.fullmatch(r"REC-(\d+)", str(val(r, "Record ID") or "")))]
    skills = {}
    for r in rows:
        name = val(r, "Skill Name")
        if name and val(r, "Skill ID") and name not in skills:
            skills[name] = {k: val(r, k) for k in ("Skill ID", "Skill Category", "Skill Description")}

    filled = []
    next_id, next_rec = max(nums, default=0) + 1, max(recs, default=0) + 1
    for r in rows:
        first, last = val(r, "First Name"), val(r, "Last Name")
        if not (first and last) or val(r, "Student ID"):
            continue
        sid = f"BTU-T-{next_id:04d}"
        set_ = lambda name, v: ws.cell(r, col(name), v)
        set_("Student ID", sid)
        set_("BTU Email (Test)", f"{sid.lower()}@example.org")
        set_("Program", val(r, "Program") or "Hackathon Jury Demo")
        set_("Education Level", val(r, "Education Level") or "Bachelor's")
        set_("Student Status", val(r, "Student Status") or "Active")
        set_("Record ID", f"REC-{next_rec:04d}")
        skill = val(r, "Skill Name") or "AI Literacy"
        set_("Skill Name", skill)
        for k, v in skills.get(skill, {}).items():
            if not val(r, k):
                set_(k, v)
        set_("Badge/Stamp Code", BADGES.get(val(r, "Skill Category"), "CHECK CATEGORY"))
        set_("Date Earned", val(r, "Date Earned") or dt.date.today().isoformat())
        filled.append(f"{first} {last} -> {sid}")
        next_id, next_rec = next_id + 1, next_rec + 1
    if filled:
        wb.save(path)
    return filled


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


def banner(name: str, email: str, pw: str, port: str) -> None:
    bar = "=" * 64
    print(f"\n\033[1;32m{bar}\n  NEW PASSPORT READY: {name}\n{bar}\033[0m")
    print(f"  Open:      http://localhost:{port}/login")
    print(f"  Email:     \033[1m{email}\033[0m")
    print(f"  Password:  \033[1m{pw}\033[0m")
    print(f"\033[1;32m{bar}\033[0m\n", flush=True)
    if sys.platform == "darwin":  # a popup on screen too, so the presenter sees it without the terminal
        msg = f"{name}\n\nhttp://localhost:{port}/login\nEmail: {email}\nPassword: {pw}".replace('"', "'")
        subprocess.Popen(["osascript", "-e",
                          f'display dialog "{msg}" with title "New passport ready" buttons {{"OK"}} default button 1'],
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
    last = None
    print(f"Watching the Google Sheet every {a.every:g}s (Ctrl-C to stop). Chain: {env.get('PASSPORT_CHAIN_NETWORK')}", flush=True)
    while True:
        try:
            raw = download(url, work / "downloaded.xlsx")
            digest = content_digest(work / "downloaded.xlsx")
            if digest != last:
                last = digest
                copy = work / "latest.xlsx"
                copy.write_bytes(raw)
                for f in fill_demo_rows(copy):
                    print(f"  filled demo row: {f}", flush=True)
                print(f"[{time.strftime('%H:%M:%S')}] sheet changed, importing ...", flush=True)
                r = subprocess.run([sys.executable, "-m", "worker", "import", "--xlsx", str(copy),
                                    "--assign-new-passport-ids", "--no-write-back"],
                                   cwd=ROOT, env=env, capture_output=True, text=True)
                for line in r.stdout.splitlines():
                    if any(w in line for w in ("passports created", "issuance", "ERROR", "HOLD")):
                        print("  " + line.strip(), flush=True)
                if r.returncode != 0:
                    print(r.stderr[-1500:], flush=True)
                for name, email, pw in new_logins(demo_dir, env):
                    banner(name, email, pw, os.environ.get("PORT", "3000"))
        except Exception as e:  # keep watching through network hiccups
            print(f"[{time.strftime('%H:%M:%S')}] {e}", flush=True)
        time.sleep(a.every)


if __name__ == "__main__":
    main()
