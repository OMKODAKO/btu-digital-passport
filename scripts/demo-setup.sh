#!/usr/bin/env bash
# Sets up the hackathon demo from nothing, on a LOCAL Hardhat devnet (chain id 31337, not a public network):
#   1. starts the devnet if it isn't running (log: data-demo/devnet.log)
#   2. deploys PassportRegistry, authorises a TEST issuer, writes a TEST trust anchor
#   3. imports BTU's workbook: every student's V1 is generated, checked and registered on-chain
#   4. creates test logins for all students and a demo staff account (passwords: data-demo/dev-credentials.txt)
#   5. writes data-demo/demo.env, which `npm run demo:start` and scripts/demo-add-skill.sh read
#
# The admin and issuer keys are generated fresh for this throwaway devnet and kept in data-demo/demo.env
# (git-ignored, mode 600). They are worthless outside it. Never put a real key in that file.
#
# usage: bash scripts/demo-setup.sh            (needs: npm install, cd chain && npm install, pip install -r worker/requirements.txt, npm run build)
set -euo pipefail
cd "$(dirname "$0")/.."
DEMO_DIR="${DEMO_DIR:-$PWD/data-demo}"
WORKBOOK="${BTU_WORKBOOK:-../AI DIGITAL PASSPORT/BTU AI Skills Digital Passport Hackathon_Test Data.xlsx}"
# A fresh clone has no ../AI DIGITAL PASSPORT folder: use the copy of BTU's (fictional) test data in the repo
[ -e "$WORKBOOK" ] || WORKBOOK="$PWD/samples/demo/workbook.xlsx"
# Use the project's virtualenv when `npm run quickstart` made one
[ -x .venv/bin/python3 ] && export PATH="$PWD/.venv/bin:$PATH"
RPC="http://127.0.0.1:8545"
PORT="${PORT:-3000}"

if [ -e "$DEMO_DIR/portal.db" ]; then
  echo "$DEMO_DIR already holds a demo. Move it away (or set DEMO_DIR) to start fresh." >&2
  exit 1
fi
mkdir -p "$DEMO_DIR"

rpc() { curl -s -X POST "$RPC" -H 'content-type: application/json' -d "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"$1\",\"params\":$2}"; }
if ! rpc eth_chainId '[]' >/dev/null 2>&1; then
  echo "Starting the local Hardhat devnet on $RPC"
  (cd chain && nohup node_modules/.bin/hardhat node --hostname 127.0.0.1 --port 8545 >"$DEMO_DIR/devnet.log" 2>&1 &)
  for _ in $(seq 1 60); do rpc eth_chainId '[]' >/dev/null 2>&1 && break; sleep 0.5; done
fi
[ "$(rpc eth_chainId '[]' | python3 -c 'import json,sys; print(int(json.load(sys.stdin)["result"],16))')" = "31337" ] \
  || { echo "The node on $RPC is not the local devnet (chain id 31337); stopping." >&2; exit 1; }

key() { echo "0x$(python3 -c 'import secrets; print(secrets.token_hex(32))')"; }
addr() { python3 -c "import sys; from eth_account import Account; print(Account.from_key(sys.argv[1]).address)" "$1"; }
ADMIN_KEY=$(key); ISSUER_KEY=$(key)
ADMIN=$(addr "$ADMIN_KEY"); ISSUER=$(addr "$ISSUER_KEY")
for a in "$ADMIN" "$ISSUER"; do rpc hardhat_setBalance "[\"$a\",\"0x56BC75E2D63100000\"]" >/dev/null; done

export DATA_DIR="$DEMO_DIR"
REGISTRY=$(PASSPORT_ADMIN_PRIVATE_KEY="$ADMIN_KEY" python3 -m worker chain deploy --rpc "$RPC" \
  | python3 -c 'import json,sys; print(json.load(sys.stdin)["registry"])')
PASSPORT_ADMIN_PRIVATE_KEY="$ADMIN_KEY" python3 -m worker chain set-issuer --rpc "$RPC" --registry "$REGISTRY" \
  --issuer "$ISSUER" --label "BTU hackathon TEST issuer" >/dev/null
python3 -m worker chain anchor --chain-id 31337 --network "local Hardhat devnet" --registry "$REGISTRY" --admin "$ADMIN" \
  --issuer "$ISSUER=BTU hackathon TEST issuer" --out "$DEMO_DIR/trust-anchor.json"

umask 077
cat >"$DEMO_DIR/demo.env" <<EOF
# Local devnet demo settings, written by scripts/demo-setup.sh. Throwaway devnet keys only.
DATA_DIR=$DEMO_DIR
STUDENT_EMAIL_DOMAINS=example.org
PASSPORT_ISSUANCE_MODE=blockchain
PASSPORT_CHAIN_RPC_URL=$RPC
PASSPORT_CHAIN_ID=31337
PASSPORT_CHAIN_NETWORK="local Hardhat devnet"
PASSPORT_REGISTRY_ADDRESS=$REGISTRY
PASSPORT_CHAIN_CONFIRMATIONS=1
PASSPORT_TRUST_ANCHOR=$DEMO_DIR/trust-anchor.json
VERIFY_BASE_URL=http://localhost:$PORT/verify
PUBLIC_BASE_URL=http://localhost:$PORT
PASSPORT_ISSUER_PRIVATE_KEY=$ISSUER_KEY
EOF
umask 022
set -a; . "$DEMO_DIR/demo.env"; set +a

npm run --silent migrate >/dev/null
python3 -m worker import --xlsx "$WORKBOOK"
python3 - "$DEMO_DIR/portal.db" >"$DEMO_DIR/emails.txt" <<'EOF'
import sqlite3, sys
for (e,) in sqlite3.connect(sys.argv[1]).execute("SELECT email FROM students ORDER BY student_id"):
    print(e)
EOF
while read -r email; do npx tsx scripts/create-login.ts "$email" >/dev/null; done <"$DEMO_DIR/emails.txt"
npx tsx scripts/create-staff.ts ops.demo@staff.example.org "Demo Operator" OPERATOR >/dev/null

echo
echo "Demo ready. Registry $REGISTRY, TEST issuer $ISSUER (local Hardhat devnet)."
echo "Start the app:      npm run demo:start      (http://localhost:$PORT)"
echo "Logins:             $DEMO_DIR/dev-credentials.txt"
echo "Add a new skill:    bash scripts/demo-add-skill.sh"
