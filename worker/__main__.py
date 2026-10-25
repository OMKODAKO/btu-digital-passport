"""Command line:

  python3 -m worker import --xlsx "<workbook.xlsx>"        import + sync, write Q–T to a copy
  python3 -m worker import --xlsx <file> --no-write-back    import + sync only
  python3 -m worker import --xlsx <file> --assign-new-passport-ids
  python3 -m worker verify --code BTU-XXXX-XXXX-XXXX [--pdf file.pdf]   check against the chain + trust anchor
  python3 -m worker chain deploy|set-issuer|anchor ...                 registry administration (chain_admin.py)
  python3 -m worker retry                                              carry out retries requested in the admin area
  python3 -m worker subjects load|list                                 add the subject catalog + simulated syllabi / show them
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from . import config
from .db import connect
from .sources.xlsx import SheetFormatError, read_workbook, write_status_copy
from .sync import Options, run_import


def main(argv=None) -> int:
    argv = sys.argv[1:] if argv is None else argv
    if argv[:1] == ["chain"]:
        from .chain_admin import main as chain_main
        return chain_main(argv[1:])
    if argv[:1] == ["verify"]:
        return _verify(argv[1:])
    if argv[:1] == ["retry"]:
        from .retry import process_retries
        done = process_retries(connect())
        for d in done:
            print(json.dumps(d, ensure_ascii=False))
        print(f"{len(done)} retry request(s) processed")
        return 1 if any(d["state"] == "FAILED" for d in done) else 0
    if argv[:1] == ["subjects"]:
        return _subjects(argv[1:])
    ap = argparse.ArgumentParser(prog="python3 -m worker")
    sub = ap.add_subparsers(dest="cmd", required=True)
    imp = sub.add_parser("import", help="import the skill workbook and generate passport versions")
    imp.add_argument("--xlsx", required=True, help="path to the BTU skill-records workbook")
    imp.add_argument("--sheet", default=None, help=f"worksheet name (default {config.SHEET_NAME!r})")
    imp.add_argument("--output", help="where to write the copy with updated Q–T (default data/exports/...)")
    imp.add_argument("--no-write-back", action="store_true", help="don't write a workbook copy")
    imp.add_argument("--assign-new-passport-ids", action="store_true",
                     help="give new students without a Passport ID the next BTU-AI number (written to the copy)")
    imp.add_argument("--apply-edits", action="store_true",
                     help="DEMO: apply edits to already-accepted rows and student details, and issue a new version")
    args = ap.parse_args(argv)

    try:
        table = read_workbook(args.xlsx, args.sheet)
    except SheetFormatError as exc:
        print(f"Import stopped, nothing changed: {exc}", file=sys.stderr)
        return 2

    conn = connect()
    result = run_import(conn, table, Options(assign_new_passport_ids=args.assign_new_passport_ids, apply_edits=args.apply_edits))
    s = result.summary

    out_path = None
    if not args.no_write_back:
        out_path = Path(args.output) if args.output else (
            config.EXPORTS_DIR / f"{Path(args.xlsx).stem} - synced run {result.run_id}.xlsx")
        s["cells_written"] = write_status_copy(args.xlsx, out_path, table, result.row_status, result.new_cells)
        s["workbook_copy"] = str(out_path)

    report = {
        "summary": s,
        "workbook": {"sheet": table.sheet_name, "header_row": table.header_row,
                     "columns": {h: _col(c) for h, c in table.columns.items()},
                     "confirmation_column": table.confirmation_column,
                     "ignored_rows": [{"row": r, "why": w} for r, w in table.ignored_rows]},
        "issues": [i.__dict__ for i in result.validation.issues],
        "preserved_synced_values": result.preserved,
    }
    config.REPORTS_DIR.mkdir(parents=True, exist_ok=True)
    report_path = config.REPORTS_DIR / f"import-run-{result.run_id}.json"
    report_path.write_text(json.dumps(report, indent=2, ensure_ascii=False))

    print(f"Import run {result.run_id}: sheet {table.sheet_name!r}, header on row {table.header_row}")
    print(f"  rows: {s['data_rows']} records, {s['ignored_note_rows']} note rows ignored, {s['blank_rows']} blank")
    print(f"  valid {s['rows_valid']}, held {s['rows_held']}, invalid {s['rows_invalid']}; "
          f"students with valid rows {s['students_with_valid_rows']}")
    print(f"  awards: {s['awards_new']} new, {s['awards_unchanged']} unchanged, "
          f"{s['awards_changed_after_accept']} edited after acceptance (kept as accepted)")
    print(f"  passports created {s['passports_created']}, versions generated {s['versions_generated']}, "
          f"generation failures {s['generation_failures']}")
    print(f"  issuance ({s['issuance_mode']} mode): {s['issued_registered']} issued with blockchain registration, "
          f"{s['issued_unregistered_demo']} issued unregistered (local demo), {s['awaiting_registration']} waiting for "
          f"registration, {s['issuance_failures']} issuance failures")
    print(f"  existing SYNCED values kept: {s['preserved_existing_synced']}; stored PDF problems: {len(s['stored_pdf_problems'])}")
    for note in s["notes"]:
        print(f"  note: {note}")
    for i in result.validation.issues:
        if i.code != "BADGE_FROM_FORMULA":
            print(f"  {i.severity:7} row {i.sheet_row} {i.record_id or ''} {i.code}: {i.message}")
    if out_path:
        print(f"  workbook copy with Q–T: {out_path} ({s['cells_written']} cells changed; original untouched)")
    print(f"  full report: {report_path}")
    return 0


def _verify(argv) -> int:
    from .chain import load_trust_anchor
    from .verify import VALID, verify

    ap = argparse.ArgumentParser(prog="python3 -m worker verify")
    ap.add_argument("--code", required=True)
    ap.add_argument("--pdf")
    args = ap.parse_args(argv)
    if not (config.TRUST_ANCHOR and config.CHAIN_RPC_URL):
        print("PASSPORT_TRUST_ANCHOR and PASSPORT_CHAIN_RPC_URL must be set", file=sys.stderr)
        return 2
    v = verify(args.code, load_trust_anchor(config.TRUST_ANCHOR), config.CHAIN_RPC_URL,
               Path(args.pdf).read_bytes() if args.pdf else None)
    print(json.dumps(v.as_dict(), indent=2))
    return 0 if v.status == VALID else 1


def _subjects(argv) -> int:
    from .subjects import CatalogError, load_catalog, passport_subjects, syllabus_components

    ap = argparse.ArgumentParser(prog="python3 -m worker subjects")
    ap.add_argument("action", choices=["load", "list"])
    args = ap.parse_args(argv)
    conn = connect()
    if args.action == "load":
        try:
            r = load_catalog(conn)
        except CatalogError as exc:
            print(f"Catalog not loaded, nothing changed: {exc}", file=sys.stderr)
            return 2
        print(f"Subjects added {len(r.subjects_added)}, syllabi added {len(r.syllabi_added)}, already present {r.unchanged}")
        for d in r.differences:
            print(f"  kept as stored: {d}")
        return 0
    for s in passport_subjects(conn):
        comps = syllabus_components(conn, s["id"])
        parts = ", ".join(f"{c['label']} {c['weight']:g}% (/{c['max_points']:g})" for c in comps)
        print(f"{s['code']:24} {s['credits']} ECTS  {s['skill_area']:16} {s['name_en']}\n{'':26}{parts}")
    return 0


def _col(n: int) -> str:
    s = ""
    while n:
        n, r = divmod(n - 1, 26)
        s = chr(65 + r) + s
    return s


if __name__ == "__main__":
    sys.exit(main())
