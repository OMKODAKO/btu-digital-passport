# Blockchain registration and BTU issuer identity (stage 4)

Every issued passport version gets an on-chain record in `PassportRegistry`
([contracts/PassportRegistry.sol](contracts/PassportRegistry.sol)). A version becomes the student's
current passport only after its record is confirmed and read back.

## What is on-chain, and what isn't

| Field | Value | Personal? |
| --- | --- | --- |
| `codeKey` (lookup key) | SHA-256 of the version's Verification Code | no. The code itself isn't stored, so codes can't be listed from the chain |
| `pdfSha256` | SHA-256 of the exact issued PDF bytes | no |
| `passportRef` | 32 random bytes per passport, kept in `passports.chain_ref` | no. It isn't derived from the Passport ID, name or email |
| `versionNo` | 1, 2, 3… must increase per passport | no |
| `issuer`, `registeredAt`, `blockNumber` | set by the contract | no |

Names, emails, student numbers, Passport IDs and skills never leave BTU's systems. A test checks the
transaction input and logs for them.

## Issuance flow (worker/chain.py, worker/sync.py)

1. The PDF is rendered, read back and checked, then stored as a candidate (stage 3).
2. The registrar re-reads the stored file and hashes the exact bytes. If the hash differs from the candidate's, it stops.
3. Preflight: the chain id is the expected one, the contract exists, the signing address is an
   **active issuer in the registry**, and, when a trust anchor is configured, the registry, admin and
   issuer match **BTU's trust anchor**. A mismatch stops it before anything is sent.
4. If the code is already registered (for example after a crash), the existing record is checked and reused,
   and nothing is sent twice. If a transaction from an earlier run is still pending, the registrar waits for it.
   A failed one is replaced.
5. The gas estimate runs first, so a transaction the contract would refuse is never sent. Then the signed transaction is sent.
   Its hash is saved on the candidate right away.
6. The registrar waits for the receipt. Status 0 means failure. It then waits for `PASSPORT_CHAIN_CONFIRMATIONS` blocks
   (default 3). If they don't arrive within `PASSPORT_CHAIN_TIMEOUT_S`, the candidate keeps waiting and the next run continues with it.
7. It reads `getRecord(codeKey)` back and compares the hash, reference, version and issuer.
8. Only then, in one database transaction, the version becomes CURRENT and the previous one SUPERSEDED.
   The audit fields are stored on `passport_versions`: tx hash, chain id, network, contract, block number and
   hash, issuer, issuer label, test flag, registration time and confirmations.

If any step fails, the candidate stays waiting and the previous version stays current. The error is
recorded on the candidate and written to column T of the workbook copy. Column Q becomes `SYNCED` only
for versions with a confirmed registration.

## Why a record should be trusted as BTU's

Checking a hash only proves that someone registered it. The contract and verifier also establish who did it:

- **Registry admin.** Only the admin can authorise or revoke issuers. In production this must be a
  BTU-controlled multisig, with keys held by named BTU officers. It must not be a developer's wallet.
- **Issuers.** The admin authorises each issuer address with a label and a `testOnly` flag. Records keep
  the issuer that wrote them. Revoking an issuer stops new records but leaves earlier ones valid.
- **BTU trust anchor.** This is a JSON statement that BTU publishes on its own domain, at
  `https://<btu domain>/.well-known/btu-passport-issuer.json`. It names the chain, the registry
  address, the admin and the issuer addresses, plus `status: OFFICIAL` or `TEST`. Its authority comes
  from BTU's domain (TLS), the same idea as `did:web`. A copy hosted anywhere else proves nothing.
- **Verifier** (`worker/verify.py`, `python3 -m worker verify`). It uses the registry named in the anchor, checks that
  the contract's admin equals the anchor's admin, and checks that the record's issuer is listed in the anchor *and*
  was authorised in the registry when the record was written. Unless the anchor says `OFFICIAL` and the issuer
  isn't test-only, it reports **"TEST ISSUER: official BTU issuer verification is still pending"**.

### Status today

There is **no BTU authorisation yet**. Every issuer created here is a `testOnly` TEST issuer, every
anchor written by `chain anchor` has `status: TEST`, and the dashboard and verifier say so.

## Setup

```bash
cd chain && npm install && npm run compile      # solc 0.8.28 -> build/PassportRegistry.json (committed)
pip install -r ../worker/requirements.txt         # includes web3
```

Keys are read only from environment variables, never from files, and they are never printed:

| Variable | Used by |
| --- | --- |
| `PASSPORT_ADMIN_PRIVATE_KEY` | `chain deploy`, `chain set-issuer` (registry admin; production: multisig instead) |
| `PASSPORT_ISSUER_PRIVATE_KEY` | `import`: signs registrations |
| `PASSPORT_CHAIN_RPC_URL`, `PASSPORT_CHAIN_ID`, `PASSPORT_CHAIN_NETWORK`, `PASSPORT_REGISTRY_ADDRESS` | network and contract |
| `PASSPORT_CHAIN_CONFIRMATIONS` (3), `PASSPORT_CHAIN_TIMEOUT_S` (180), `PASSPORT_CHAIN_MIN_PRIORITY_FEE_GWEI` | confirmation and fee rules |
| `PASSPORT_TRUST_ANCHOR` | path or https URL of BTU's trust anchor (required for verification) |

```bash
python3 -m worker chain deploy --rpc $RPC                                  # prints registry address + admin
python3 -m worker chain set-issuer --rpc $RPC --registry 0x… --issuer 0x… --label "BTU hackathon TEST issuer"
python3 -m worker chain anchor --chain-id 80002 --network "Polygon Amoy testnet" --registry 0x… --admin 0x… \
        --issuer "0x…=BTU hackathon TEST issuer" --out trust-anchor.json
PASSPORT_ISSUER_PRIVATE_KEY=… npm run import -- "<workbook>"               # registers and issues waiting versions
python3 -m worker verify --code BTU-XXXX-XXXX-XXXX --pdf passport.pdf       # VALID / NOT_FOUND / HASH_MISMATCH / ISSUER_NOT_TRUSTED
```

## Networks

- **Tested:** a local Hardhat devnet (`npm run devnet`, chain id 31337). It's a real EVM node with real
  transactions and receipts, configured so a reverted transaction is mined with status 0, as on public
  networks. It is **not a public test network**.
- **Intended public test network:** Polygon Amoy (chain id 80002). It hasn't been run yet: this environment
  blocked `rpc-amoy.polygon.technology`, and there is no funded test wallet. To run it: allow that host in the
  cloud environment, add a funded **fresh** test wallet's key as `PASSPORT_ISSUER_PRIVATE_KEY` (and an admin
  key for deployment), deploy, authorise the issuer, write the anchor, and run the import.
  Amoy needs a minimum priority fee of about 25–30 gwei (`PASSPORT_CHAIN_MIN_PRIORITY_FEE_GWEI=30`).

## Production requirements (BTU decisions)

1. A BTU-controlled admin: a multisig such as Safe, with named BTU signers. Deploy the registry with it as `admin`.
2. A BTU issuer key held in a key-management service or HSM, not in an environment file. Authorise it with `testOnly = false`.
3. Publish the trust anchor with `status: OFFICIAL` on BTU's real domain, and keep it updated when issuers rotate.
4. Choose the production network and the number of confirmations.
5. Write a key-rotation and revocation procedure. Revoking an issuer keeps earlier records valid.
6. Replace the QR placeholder domain with BTU's real domain. The QR codes point to the public verification page
   `/verify/<code>` (stage 5), which runs the same checks as `worker/verify.py` on the server.
