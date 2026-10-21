#!/usr/bin/env bash
# Demo step 6-7: stands in for "BTU staff add a CONFIRMED skill in Google Sheets" (the Sheets reader is not
# built). Writes a COPY of the workbook with a "Verification Status" column and new rows (one CONFIRMED skill
# for BTU-T-0001, a PENDING and a REJECTED row, and two rows with bad Student IDs), then runs the sync.
#   bash scripts/demo-add-skill.sh            sync with blockchain registration (V2 becomes current)
#   bash scripts/demo-add-skill.sh --hold     sync WITHOUT the issuer key: V2 is generated but waits, V1 stays current
# Run it again to show that a repeat sync changes nothing.
set -euo pipefail
cd "$(dirname "$0")/.."
DEMO_DIR="${DEMO_DIR:-$PWD/data-demo}"
WORKBOOK="${BTU_WORKBOOK:-../AI DIGITAL PASSPORT/BTU AI Skills Digital Passport Hackathon_Test Data.xlsx}"
set -a; . "$DEMO_DIR/demo.env"; set +a
EDITED="$DEMO_DIR/workbook-with-new-skill.xlsx"
[ -e "$EDITED" ] || python3 tests/fixtures/confirmed_rows.py "$WORKBOOK" "$EDITED" | python3 -m json.tool
if [ "${1:-}" = "--hold" ]; then
  env -u PASSPORT_ISSUER_PRIVATE_KEY python3 -m worker import --xlsx "$EDITED"
else
  python3 -m worker import --xlsx "$EDITED"
fi
