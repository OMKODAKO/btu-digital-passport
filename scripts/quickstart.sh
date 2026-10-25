#!/usr/bin/env bash
# One command from a fresh clone to a running demo:   npm run quickstart
#   1. checks Node.js 22+ and Python 3.10+
#   2. installs the web app, the local chain tooling and the Python worker (in .venv/) if they are missing
#   3. builds the web app if it isn't built
#   4. sets up the demo in data-demo/ (local Hardhat devnet, TEST issuer, 18 demo students, V1 on-chain)
#      If data-demo/ exists but its devnet is gone (after a reboot, the devnet keeps nothing), the old demo is
#      moved to data-demo-old-<time>/ and a fresh one is made, with new passwords.
#   5. starts the app on http://localhost:3000 with one-click demo sign-in (no passwords; Google sign-in when
#      data-demo/google.env holds an OAuth client, see docs/GOOGLE-SIGNIN.md)
#
# Nothing here needs a key, a wallet or a Google account. Every key and password is generated fresh for a
# throwaway local devnet and stays in data-demo/ (git-ignored).
set -euo pipefail
cd "$(dirname "$0")/.."
DEMO_DIR="${DEMO_DIR:-$PWD/data-demo}"
RPC="http://127.0.0.1:8545"
PORT="${PORT:-3000}"

say() { printf '\n\033[1m== %s\033[0m\n' "$*"; }
die() { printf '\n\033[31m%s\033[0m\n' "$*" >&2; exit 1; }

say "Checking Node.js and Python"
command -v node >/dev/null || die "Node.js is missing. Install Node.js 22 or newer: https://nodejs.org"
[ "$(node -p 'process.versions.node.split(".")[0]')" -ge 22 ] || die "Node.js $(node -v) is too old; install Node.js 22 or newer."
command -v python3 >/dev/null || die "Python 3 is missing. Install Python 3.10 or newer: https://www.python.org"
python3 -c 'import sys; sys.exit(sys.version_info < (3, 10))' || die "Python $(python3 -V) is too old; install 3.10 or newer."
command -v curl >/dev/null || die "curl is missing; install it first."
# another app (e.g. a second copy of the portal) already on this port would answer the browser instead
if curl -s -m 2 -o /dev/null "http://127.0.0.1:$PORT/"; then
  die "Port $PORT is already in use by another app. Stop it, or pick another port: PORT=3100 npm run quickstart"
fi
echo "node $(node -v), $(python3 -V)"

if [ ! -d node_modules ]; then say "Installing the web app (npm ci)"; npm ci; fi
if [ ! -d chain/node_modules ]; then say "Installing the local chain tooling"; (cd chain && npm ci); fi
if ! .venv/bin/python3 -c 'import openpyxl, fitz, qrcode, web3' 2>/dev/null; then
  say "Installing the Python worker into .venv/"
  [ -x .venv/bin/python3 ] || python3 -m venv .venv || die "Could not create .venv. On Debian/Ubuntu: sudo apt install python3-venv"
  .venv/bin/python3 -m pip install -q --upgrade pip
  .venv/bin/python3 -m pip install -q -r worker/requirements.txt
fi
export PATH="$PWD/.venv/bin:$PATH"

# rebuild when the code changed since the last build (e.g. after a git pull)
HEAD_NOW=$(git rev-parse HEAD 2>/dev/null || echo none)
if [ ! -f .next/BUILD_ID ] || [ "$(cat .next/.quickstart-head 2>/dev/null)" != "$HEAD_NOW" ]; then
  say "Building the web app"; npm run build; echo "$HEAD_NOW" > .next/.quickstart-head
fi

devnet_up() { curl -s -m 2 -X POST "$RPC" -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"eth_chainId","params":[]}' 2>/dev/null | grep -q '"0x7a69"'; }
registry_alive() {
  local reg; reg=$(sed -n 's/^PASSPORT_REGISTRY_ADDRESS=//p' "$DEMO_DIR/demo.env" 2>/dev/null)
  [ -n "$reg" ] && curl -s -m 2 -X POST "$RPC" -H 'content-type: application/json' \
    -d "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"eth_getCode\",\"params\":[\"$reg\",\"latest\"]}" | grep -qv '"result":"0x"'
}

if [ -e "$DEMO_DIR/portal.db" ] && ! { devnet_up && registry_alive; }; then
  OLD="$DEMO_DIR-old-$(date +%Y%m%d-%H%M%S)"
  say "The local devnet behind the old demo is gone; moving it to $OLD and starting fresh"
  mv "$DEMO_DIR" "$OLD"
fi
if [ ! -e "$DEMO_DIR/portal.db" ]; then
  say "Setting up the demo (about a minute)"
  DEMO_DIR="$DEMO_DIR" PORT="$PORT" bash scripts/demo-setup.sh
fi

# the subject catalog with its simulated syllabi (adds only what is missing; never changes a stored subject)
DATA_DIR="$DEMO_DIR" python3 -m worker subjects load >/dev/null

say "Signing in: no passwords"
echo "Students:  http://localhost:$PORT/login        pick any student from the list"
echo "Staff:     http://localhost:$PORT/admin/login  one click on Demo Operator"
if [ -f "$DEMO_DIR/google.env" ]; then echo "Google:    on (settings from $DEMO_DIR/google.env)"; fi
echo "Verify:    http://localhost:$PORT/verify   (no login; use a code from a student's dashboard)"
echo "More:      npm run demo:add-skill   (in a second terminal: adds a CONFIRMED skill, V2 goes on-chain)"

say "Starting the app on http://localhost:$PORT  (Ctrl+C stops it and the badge publisher; the devnet keeps running)"
set -a; . "$DEMO_DIR/demo.env"; set +a
# Google sign-in, when an OAuth client is set up (see docs/GOOGLE-SIGNIN.md); it may also widen STUDENT_EMAIL_DOMAINS
if [ -f "$DEMO_DIR/google.env" ]; then set -a; . "$DEMO_DIR/google.env"; set +a; fi
# one-click demo sign-in instead of passwords; the app listens on 127.0.0.1 only, so no other computer can use it
export PASSPORT_DEMO_LOGIN=1
# own cookie names, so signing in here never signs you out of another copy of the portal on localhost
export PASSPORT_COOKIE_PREFIX="${PASSPORT_COOKIE_PREFIX:-bdp_demo_$PORT}"
# subject badges: when marks give a new or different badge, a new passport version is made and registered on the
# local devnet within ~10 s (demo data only; a marked student without a passport gets the next Passport ID)
echo "Badges:    new passport versions follow subject marks every 10 s (log: $DEMO_DIR/badges.log)"
python3 -m worker subjects publish --assign-new-passport-ids --watch 10 >>"$DEMO_DIR/badges.log" 2>&1 &
BADGES_PID=$!
trap 'kill $BADGES_PID 2>/dev/null' EXIT INT TERM
node_modules/.bin/next start -p "$PORT" -H 127.0.0.1
