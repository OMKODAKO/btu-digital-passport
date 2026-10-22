#!/usr/bin/env bash
# Same as demo-setup.sh, but on the PUBLIC Ethereum Sepolia testnet (chain id 11155111) instead of the local devnet.
# Needs $DEMO_DIR/keys.env with two fresh TEST wallets (admin funded from a faucet). Throwaway test keys only.
#   DEMO_DIR=data-testnet npm run demo:start     starts the app on these records afterwards
set -euo pipefail
cd "$(dirname "$0")/.."
DEMO_DIR="${DEMO_DIR:-$PWD/data-testnet}"
WORKBOOK="${BTU_WORKBOOK:-../AI DIGITAL PASSPORT/BTU AI Skills Digital Passport Hackathon_Test Data.xlsx}"
RPC="${TESTNET_RPC:-https://ethereum-sepolia-rpc.publicnode.com}"
CHAIN_ID=11155111
NETWORK="Ethereum Sepolia testnet"
PORT="${PORT:-3000}"

if [ -e "$DEMO_DIR/portal.db" ]; then
  echo "$DEMO_DIR already holds a demo. Move it away (or set DEMO_DIR) to start fresh." >&2
  exit 1
fi
set -a; . "$DEMO_DIR/keys.env"; set +a

# Give the issuer wallet a share of the admin's test ETH so it can pay for registrations.
python3 - "$RPC" "$CHAIN_ID" <<'EOF'
import os, sys
from web3 import Web3
w3 = Web3(Web3.HTTPProvider(sys.argv[1], request_kwargs={"timeout": 30}))
assert w3.eth.chain_id == int(sys.argv[2]), "wrong network"
admin = w3.eth.account.from_key(os.environ["PASSPORT_ADMIN_PRIVATE_KEY"])
issuer = os.environ["ISSUER_ADDRESS"]
bal, ibal = w3.eth.get_balance(admin.address), w3.eth.get_balance(issuer)
print(f"admin {Web3.from_wei(bal, 'ether')}, issuer {Web3.from_wei(ibal, 'ether')}")
if ibal < bal // 4:
    tip = w3.eth.max_priority_fee
    tx = {"from": admin.address, "to": issuer, "value": bal // 2, "chainId": int(sys.argv[2]),
          "nonce": w3.eth.get_transaction_count(admin.address, "pending")}
    # Estimated, not a fixed 21000: a 21000-gas transfer ran out of gas on Sepolia.
    tx["gas"] = int(w3.eth.estimate_gas(tx) * 1.2)
    tx.update(maxPriorityFeePerGas=tip, maxFeePerGas=2 * w3.eth.get_block("latest")["baseFeePerGas"] + tip)
    h = w3.eth.send_raw_transaction(admin.sign_transaction(tx).raw_transaction)
    assert w3.eth.wait_for_transaction_receipt(h, timeout=300)["status"] == 1, f"funding tx {h.to_0x_hex()} failed"
    print("funded issuer, tx", h.to_0x_hex())
EOF

export DATA_DIR="$DEMO_DIR"
DEPLOY=$(python3 -m worker chain deploy --rpc "$RPC")
echo "deploy: $DEPLOY"
REGISTRY=$(echo "$DEPLOY" | python3 -c 'import json,sys; print(json.load(sys.stdin)["registry"])')
python3 -m worker chain set-issuer --rpc "$RPC" --registry "$REGISTRY" \
  --issuer "$ISSUER_ADDRESS" --label "BTU hackathon TEST issuer"
python3 -m worker chain anchor --chain-id "$CHAIN_ID" --network "$NETWORK" --registry "$REGISTRY" --admin "$ADMIN_ADDRESS" \
  --issuer "$ISSUER_ADDRESS=BTU hackathon TEST issuer" --out "$DEMO_DIR/trust-anchor.json"

umask 077
cat >"$DEMO_DIR/demo.env" <<EOF
# Sepolia testnet demo settings, written by scripts/testnet-setup.sh. Throwaway test keys only.
DATA_DIR=$DEMO_DIR
STUDENT_EMAIL_DOMAINS=example.org
PASSPORT_ISSUANCE_MODE=blockchain
PASSPORT_CHAIN_RPC_URL=$RPC
PASSPORT_CHAIN_ID=$CHAIN_ID
PASSPORT_CHAIN_NETWORK="$NETWORK"
PASSPORT_REGISTRY_ADDRESS=$REGISTRY
PASSPORT_REGISTRY_FROM_BLOCK=$(echo "$DEPLOY" | python3 -c 'import json,sys; print(json.load(sys.stdin)["block_number"])')
PASSPORT_CHAIN_CONFIRMATIONS=1
PASSPORT_CHAIN_TIMEOUT_S=300
PASSPORT_TRUST_ANCHOR=$DEMO_DIR/trust-anchor.json
VERIFY_BASE_URL=http://localhost:$PORT/verify
PUBLIC_BASE_URL=http://localhost:$PORT
PASSPORT_ISSUER_PRIVATE_KEY=$PASSPORT_ISSUER_PRIVATE_KEY
EOF
umask 022
unset PASSPORT_ADMIN_PRIVATE_KEY
set -a; . "$DEMO_DIR/demo.env"; set +a

npm run --silent migrate >/dev/null
python3 -m worker import --xlsx "$WORKBOOK" ${IMPORT_FLAGS:-}
python3 - "$DEMO_DIR/portal.db" >"$DEMO_DIR/emails.txt" <<'EOF'
import sqlite3, sys
for (e,) in sqlite3.connect(sys.argv[1]).execute("SELECT email FROM students ORDER BY student_id"):
    print(e)
EOF
while read -r email; do npx tsx scripts/create-login.ts "$email" >/dev/null; done <"$DEMO_DIR/emails.txt"
npx tsx scripts/create-staff.ts ops.demo@staff.example.org "Demo Operator" OPERATOR >/dev/null

echo
echo "Testnet demo ready. Registry https://sepolia.etherscan.io/address/$REGISTRY"
echo "Start the app:  DEMO_DIR=$DEMO_DIR npm run demo:start"
echo "Logins:         $DEMO_DIR/dev-credentials.txt"
