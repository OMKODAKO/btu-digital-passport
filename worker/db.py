"""SQLite access for the worker. Applies the same db/migrations files as the web app."""
from __future__ import annotations

import json
import sqlite3
from datetime import datetime, timezone

from . import config


def utc_now() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def connect(path=None) -> sqlite3.Connection:
    config.DATA_DIR.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(path or config.DB_PATH, isolation_level=None)  # explicit transactions only
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    conn.execute("PRAGMA journal_mode = WAL")
    conn.execute("PRAGMA busy_timeout = 5000")
    apply_migrations(conn)
    return conn


def apply_migrations(conn: sqlite3.Connection) -> list[str]:
    """Runs db/migrations/NNN_*.sql once each, in order, each inside one transaction."""
    conn.execute("CREATE TABLE IF NOT EXISTS schema_migrations (version TEXT PRIMARY KEY, applied_at TEXT NOT NULL)")
    done = {r[0] for r in conn.execute("SELECT version FROM schema_migrations")}
    applied = []
    for f in sorted(config.MIGRATIONS_DIR.glob("[0-9][0-9][0-9]_*.sql")):
        version = f.name[:3]
        if version in done:
            continue
        sql = f.read_text(encoding="utf-8")
        conn.executescript(
            f"BEGIN;\n{sql}\nINSERT INTO schema_migrations (version, applied_at) VALUES ('{version}', '{utc_now()}');\nCOMMIT;"
        )
        applied.append(f.name)
    return applied


class transaction:
    """with transaction(conn): ...  commits on success, rolls back on any exception."""

    def __init__(self, conn: sqlite3.Connection):
        self.conn = conn

    def __enter__(self):
        self.conn.execute("BEGIN IMMEDIATE")
        return self.conn

    def __exit__(self, exc_type, exc, tb):
        self.conn.execute("ROLLBACK" if exc_type else "COMMIT")
        return False


def audit(conn: sqlite3.Connection, action: str, passport_fk: int | None = None, actor: str = "worker", **details) -> None:
    """Appends one audit_log entry (migration 005). Details must never contain secrets."""
    conn.execute(
        "INSERT INTO audit_log (at, actor_kind, actor_ref, action, passport_fk, details) VALUES (?, 'WORKER', ?, ?, ?, ?)",
        (utc_now(), actor, action, passport_fk, json.dumps(details, ensure_ascii=False) if details else None))
