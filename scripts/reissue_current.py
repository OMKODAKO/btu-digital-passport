"""Issue the next version of every passport whose current PDF predates a layout change (same skills, new PDF).

  set -a; . data-testnet/demo.env; set +a; .venv/bin/python scripts/reissue_current.py [--dry-run]

A passport is reissued when its current PDF's cover does not show the student's program yet. Each new version
is generated, checked and registered exactly like an import would do it; the old version becomes superseded.
"""
from __future__ import annotations

import sys
from pathlib import Path

import pymupdf

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from worker import chain, config  # noqa: E402
from worker.db import connect  # noqa: E402
from worker.sync import generate_if_needed, try_issue  # noqa: E402


def main() -> None:
    dry = "--dry-run" in sys.argv
    conn = connect()
    todo = []
    for p in conn.execute(
            """SELECT p.*, s.program, v.pdf_storage_key FROM passports p JOIN students s ON s.id = p.student_fk
               JOIN passport_versions v ON v.passport_fk = p.id AND v.status = 'CURRENT' ORDER BY p.passport_id"""):
        cover = pymupdf.open(config.STORAGE_DIR / p["pdf_storage_key"])[0].get_text()
        if p["program"] and p["program"].upper()[:20] not in cover.upper():
            todo.append(p)
    print(f"{len(todo)} passport(s) to reissue: " + ", ".join(p["passport_id"] for p in todo), flush=True)
    if dry:
        return
    registrar = chain.configured_registrar()
    for p in todo:
        outcome = generate_if_needed(conn, p, force=True)
        c = conn.execute("SELECT * FROM version_candidates WHERE passport_fk = ? AND state = 'AWAITING_REGISTRATION'",
                         (p["id"],)).fetchone()
        result = try_issue(conn, c, registrar) if c else "nothing generated"
        print(f"  {p['passport_id']}: {outcome} -> {result}", flush=True)


if __name__ == "__main__":
    main()
