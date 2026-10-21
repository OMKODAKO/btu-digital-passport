"""Settings, read from environment variables with safe defaults. Nothing here is secret."""
from __future__ import annotations

import os
from pathlib import Path

PORTAL_ROOT = Path(__file__).resolve().parent.parent


def set_data_dir(path) -> None:
    """Points the worker at a data folder (database, stored PDFs, reports, exports)."""
    global DATA_DIR, DB_PATH, STORAGE_DIR, REPORTS_DIR, EXPORTS_DIR
    DATA_DIR = Path(path).resolve()
    DB_PATH = DATA_DIR / "portal.db"
    STORAGE_DIR = DATA_DIR / "storage"
    REPORTS_DIR = DATA_DIR / "reports"
    EXPORTS_DIR = DATA_DIR / "exports"


set_data_dir(os.environ.get("DATA_DIR", PORTAL_ROOT / "data"))
MIGRATIONS_DIR = PORTAL_ROOT / "db" / "migrations"

# Printed in each PDF's QR code. Placeholder until the public verify page exists (stage 4/5).
VERIFY_BASE_URL = os.environ.get("VERIFY_BASE_URL", "https://passport.btu.edu.ge/verify")

SHEET_NAME = os.environ.get("PASSPORT_SHEET_NAME", "Passport Skill Records")

# ---- Confirmation rule (assignment: only CONFIRMED skills may reach a passport) ----
# The supplied workbook has no confirmation column; its notes say every A–P row is an already
# verified award. If a column with this header is added, only rows whose value is in
# CONFIRMED_VALUES are accepted; every other row is held.
CONFIRMATION_COLUMN = os.environ.get("PASSPORT_CONFIRMATION_COLUMN", "Verification Status")
CONFIRMED_VALUES = {v.strip().upper() for v in os.environ.get("PASSPORT_CONFIRMED_VALUES", "CONFIRMED").split(",")}
# What to do when the column is absent:
#   AWARDED  – treat every complete row as an awarded skill (the workbook's own rule; default)
#   HOLD     – accept nothing until a confirmation column exists
CONFIRMATION_WHEN_ABSENT = os.environ.get("PASSPORT_CONFIRMATION_WHEN_ABSENT", "AWARDED").upper()

# ---- Issuance ----
# A generated version becomes the student's current passport only after the issuance steps succeed.
#   blockchain  – (default) its PDF hash must be registered on-chain first. The registrar arrives with
#                 the blockchain stage; until then new versions wait as candidates and the previous
#                 version stays current.
#   local-demo  – for demonstrations only: issued right after the PDF check, with no chain transaction.
#                 Such versions show "not registered on a blockchain" and are never marked SYNCED.
ISSUANCE_MODE = os.environ.get("PASSPORT_ISSUANCE_MODE", "blockchain").strip().lower()
if ISSUANCE_MODE not in ("blockchain", "local-demo"):
    raise SystemExit(f"PASSPORT_ISSUANCE_MODE must be 'blockchain' or 'local-demo', not {ISSUANCE_MODE!r}")

# ---- Blockchain (stage 4) ----
# All optional: without RPC URL, registry address and issuer key there is no registrar, and new
# versions wait. The private key is read from the environment only when signing; never logged or stored.
CHAIN_RPC_URL = os.environ.get("PASSPORT_CHAIN_RPC_URL", "")
CHAIN_ID = int(os.environ.get("PASSPORT_CHAIN_ID", "0") or 0)
CHAIN_NETWORK = os.environ.get("PASSPORT_CHAIN_NETWORK", "")           # e.g. "Polygon Amoy testnet"
REGISTRY_ADDRESS = os.environ.get("PASSPORT_REGISTRY_ADDRESS", "")
CHAIN_CONFIRMATIONS = int(os.environ.get("PASSPORT_CHAIN_CONFIRMATIONS", "3"))
CHAIN_TIMEOUT_S = float(os.environ.get("PASSPORT_CHAIN_TIMEOUT_S", "180"))
CHAIN_MIN_PRIORITY_FEE_GWEI = float(os.environ.get("PASSPORT_CHAIN_MIN_PRIORITY_FEE_GWEI", "0"))
# BTU trust anchor: the file BTU publishes on its own domain naming the registry, its admin and the
# authorised issuers (path or https URL). Verification fails closed without it.
TRUST_ANCHOR = os.environ.get("PASSPORT_TRUST_ANCHOR", "")
CONTRACT_ARTIFACT = PORTAL_ROOT / "chain" / "build" / "PassportRegistry.json"
