"""Builds a SYNTHETIC workbook in BTU's layout for scale tests. Every name, email and ID is invented
and labelled synthetic; nothing here is BTU data.

usage: python3 scripts/scale/make_workbook.py <BTU workbook> <out.xlsx> <students> [skills per student] [--extra-skill[=N]]
  --extra-skill    adds one more skill row per student (an "update" run after the first issuance)
  --extra-skill=N  adds it for the first N students only"""
import random
import sys

import openpyxl

src, out, n = sys.argv[1], sys.argv[2], int(sys.argv[3])
per = int(sys.argv[4]) if len(sys.argv) > 4 and sys.argv[4].isdigit() else 3
flag = next((a for a in sys.argv if a.startswith("--extra-skill")), None)
extra_for = (int(flag.split("=")[1]) if "=" in flag else 10**9) if flag else 0
wb = openpyxl.load_workbook(src)
ws = wb["Passport Skill Records"]
vals = openpyxl.load_workbook(src, data_only=True)["Passport Skill Records"]
HEADER = 4
skills = {}
for r in range(HEADER + 1, ws.max_row + 1):
    if str(ws.cell(r, 1).value or "").startswith("BTU-T-"):
        skills[ws.cell(r, 11).value] = [vals.cell(r, c).value for c in (11, 12, 13, 14, 15)]
skills = [skills[k] for k in sorted(skills)]
ws.delete_rows(HEADER + 1, ws.max_row - HEADER)
rnd = random.Random(42)
row, rec = HEADER + 1, 100000
for i in range(n):
    sid = f"BTU-T-{5000 + i:04d}"
    pid = f"BTU-AI-{300000 + i:06d}"
    picks = rnd.sample(skills, min(len(skills), per + 1))[: per + (1 if i < extra_for else 0)]  # same first rows either way
    for k, s in enumerate(picks):
        rec += 1
        ws.cell(row, 1).value = sid
        ws.cell(row, 2).value = f"Synthetic{i}"
        ws.cell(row, 3).value = "Student"
        ws.cell(row, 4).value = f"{sid.lower()}@example.org"
        ws.cell(row, 5).value = "Synthetic Program"
        ws.cell(row, 6).value = "Bachelor's"
        ws.cell(row, 7).value = pid
        ws.cell(row, 8).value = "2026-09-15"
        ws.cell(row, 9).value = "Active"
        ws.cell(row, 10).value = f"REC-{1000000 + i * 10 + k}"
        for c, v in zip((11, 12, 13, 14, 15), s):
            ws.cell(row, c).value = v
        ws.cell(row, 16).value = f"2026-10-{1 + k:02d}"
        ws.cell(row, 17).value = "NOT SYNCED"
        row += 1
wb.save(out)
print(f"{n} synthetic students, {row - HEADER - 1} rows -> {out}")
