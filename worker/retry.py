"""Carries out retry requests that staff recorded in the admin area (retry_requests, migration 005).

  python3 -m worker retry        process every REQUESTED retry, oldest first

A retry repeats, for one passport only, the two steps of an import that can fail:
  - generation: if the passport's accepted skills are missing from its newest version, render a new
    candidate from those accepted skills (sync.generate_if_needed);
  - issuance: register and issue the waiting candidate, if any (sync.try_issue). The registrar first
    checks for an existing on-chain record or a pending transaction, so nothing is registered twice.

It never reads the sheet and never changes a source record or skill award, so a pending, held or
rejected skill can't become confirmed this way. If a step fails, the previous version stays current.
"""
from __future__ import annotations

import json
import sqlite3

from . import chain
from .db import audit, utc_now
from .issue import waiting_candidate
from .sync import generate_if_needed, try_issue


def process_retries(conn: sqlite3.Connection, registrar="configured", renderer=None) -> list[dict]:
    registrar = chain.configured_registrar() if registrar == "configured" else registrar
    done = []
    for req in conn.execute("SELECT * FROM retry_requests WHERE state = 'REQUESTED' ORDER BY id").fetchall():
        # claim it, so a second worker running at the same time skips it
        if conn.execute("UPDATE retry_requests SET state = 'RUNNING', started_at = ? WHERE id = ? AND state = 'REQUESTED'",
                        (utc_now(), req["id"])).rowcount != 1:
            continue
        passport = conn.execute("SELECT * FROM passports WHERE id = ?", (req["passport_fk"],)).fetchone()
        result: dict = {}
        try:
            gen = generate_if_needed(conn, passport, renderer)
            result["generation"] = ("not needed" if gen is None else gen if isinstance(gen, str)
                                    else f"failed: {gen[1][:300]}")
            c = waiting_candidate(conn, passport["id"])
            result["issuance"] = try_issue(conn, c, registrar) if c else "nothing waiting"
            if result["issuance"] == "waiting":
                result["issuance_error"] = "no blockchain registrar is configured for the worker (network, registry or issuer key missing)"
            if c and result["issuance"] == "failed":
                result["issuance_error"] = conn.execute(
                    "SELECT last_registration_error FROM version_candidates WHERE id = ?", (c["id"],)).fetchone()[0]
        except Exception as exc:  # unexpected: recorded, the previous version stays current
            result["error"] = str(exc)[:300]
        failed = "error" in result or result.get("generation", "").startswith("failed") or result.get("issuance") in ("failed", "waiting")
        state = ("FAILED" if failed else
                 "NOTHING_TO_DO" if result.get("generation") == "not needed" and result.get("issuance") == "nothing waiting"
                 else "DONE")
        conn.execute("UPDATE retry_requests SET state = ?, finished_at = ?, result_json = ? WHERE id = ?",
                     (state, utc_now(), json.dumps(result), req["id"]))
        audit(conn, f"RETRY_{state}", passport["id"], request_id=req["id"], **result)
        done.append({"request_id": req["id"], "passport_id": passport["passport_id"], "state": state, **result})
    return done
