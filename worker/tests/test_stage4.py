"""Stage 4 tests: registration on a real EVM chain and issuer verification.

    python3 -m unittest worker.tests.test_stage4 -v      (needs: cd chain && npm install)

The tests start a local Hardhat node (chain id 31337) and send real transactions to the compiled
PassportRegistry; every receipt and on-chain record they check is real. It is a local devnet, not a
public test network. Keys are generated fresh for each test and funded through the node; none are
stored anywhere.
"""
from __future__ import annotations

import hashlib
import secrets
import shutil
import socket
import subprocess
import tempfile
import time
import unittest
from pathlib import Path

from web3 import Web3

from worker import chain_admin, config
from worker.chain import EvmRegistrar, RegistrationError, code_key, load_artifact
from worker.db import connect
from worker.issue import chain_ref, issue_candidate, record_submitted_tx
from worker.sources.xlsx import read_workbook
from worker.sync import Options, run_import
from worker.tests.test_import import WORKBOOK
from worker.tests.test_stage3 import STUDENT1, flat, with_new_skills
from worker.verify import HASH_MISMATCH, ISSUER_NOT_TRUSTED, NOT_FOUND, VALID, verify

TMP_ROOT = Path(tempfile.mkdtemp(prefix="bdp-stage4-"))
CHAIN_DIR = config.PORTAL_ROOT / "chain"
NODE = None
RPC = None
BASELINE = None


def _free_port() -> int:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def setUpModule():
    global NODE, RPC, BASELINE
    if not (CHAIN_DIR / "node_modules" / ".bin" / "hardhat").exists():
        raise RuntimeError("Hardhat is not installed: run `cd chain && npm install` first")
    port = _free_port()
    RPC = f"http://127.0.0.1:{port}"
    NODE = subprocess.Popen([str(CHAIN_DIR / "node_modules" / ".bin" / "hardhat"), "node", "--hostname", "127.0.0.1",
                             "--port", str(port)], cwd=CHAIN_DIR, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    w3 = Web3(Web3.HTTPProvider(RPC))
    for _ in range(120):
        try:
            if w3.eth.chain_id == 31337:
                break
        except Exception:  # noqa: BLE001
            time.sleep(0.25)
    else:
        raise RuntimeError("local devnet did not start")
    config.ISSUANCE_MODE = "blockchain"
    BASELINE = TMP_ROOT / "baseline"
    config.set_data_dir(BASELINE)
    conn = connect()
    run_import(conn, read_workbook(WORKBOOK), Options(registrar=None))  # 18 candidates waiting
    conn.close()


def tearDownModule():
    if NODE:
        NODE.terminate()
        NODE.wait(10)
    shutil.rmtree(TMP_ROOT, ignore_errors=True)


class Chain:
    """A fresh registry with a fresh admin and a fresh TEST issuer, plus BTU's trust anchor for it."""
    def __init__(self, label="BTU hackathon TEST issuer"):
        self.w3 = Web3(Web3.HTTPProvider(RPC))
        self.admin_key, self.issuer_key = "0x" + secrets.token_hex(32), "0x" + secrets.token_hex(32)
        self.admin = self.fund(self.admin_key)
        self.issuer = self.fund(self.issuer_key)
        d = chain_admin.deploy(RPC, self.admin_key)
        self.registry = d["registry"]
        chain_admin.set_issuer(RPC, self.registry, self.admin_key, self.issuer, active=True, test_only=True, label=label)
        self.anchor = chain_admin.trust_anchor(31337, "local Hardhat devnet", self.registry, self.admin,
                                               [{"address": self.issuer, "label": label, "test_only": True}])
        self.contract = self.w3.eth.contract(address=self.registry, abi=load_artifact()["abi"])

    def fund(self, key) -> str:
        addr = self.w3.eth.account.from_key(key).address
        self.w3.provider.make_request("hardhat_setBalance", [addr, hex(10 ** 20)])
        return addr

    def registrar(self, key=None, **kw) -> EvmRegistrar:
        kw.setdefault("confirmations", 1)
        kw.setdefault("timeout_s", 20)
        kw.setdefault("poll_s", 0.05)
        return EvmRegistrar(kw.pop("rpc", RPC), 31337, self.registry, key or self.issuer_key, network="local Hardhat devnet",
                            anchor=kw.pop("anchor", self.anchor), **kw)

    def mine(self, n=1):
        for _ in range(n):
            self.w3.provider.make_request("evm_mine", [])

    def nonce(self, addr=None) -> int:
        return self.w3.eth.get_transaction_count(addr or self.issuer)

    def registrations(self, code: str) -> int:
        return len(self.contract.events.VersionRegistered().get_logs(from_block=0, argument_filters={"codeKey": code_key(code)}))


class Base(unittest.TestCase):
    def setUp(self):
        self.dir = TMP_ROOT / f"case-{self.id().split('.')[-1]}"
        shutil.copytree(BASELINE, self.dir)
        config.set_data_dir(self.dir)
        config.ISSUANCE_MODE = "blockchain"
        self.conn = connect()
        self.chain = Chain()

    def tearDown(self):
        self.conn.close()

    def q(self, sql, *a):
        return self.conn.execute(sql, a).fetchall()

    def one(self, sql, *a):
        return self.conn.execute(sql, a).fetchone()

    def sync(self, path=WORKBOOK, **opts):
        t = read_workbook(path)
        return t, run_import(self.conn, t, Options(**opts))

    def cand(self, passport_id="BTU-AI-000125", state="AWAITING_REGISTRATION"):
        return self.one("""SELECT c.* FROM version_candidates c JOIN passports p ON p.id = c.passport_fk
                           WHERE p.passport_id = ? AND c.state = ? ORDER BY c.version_no DESC""", passport_id, state)

    def current(self, passport_id="BTU-AI-000125"):
        return self.one("""SELECT v.* FROM passport_versions v JOIN passports p ON p.id = v.passport_fk
                           WHERE p.passport_id = ? AND v.status = 'CURRENT'""", passport_id)

    def pdf(self, row) -> bytes:
        return (config.STORAGE_DIR / row["pdf_storage_key"]).read_bytes()

    def register_one(self, registrar, c):
        reg = registrar.register(c, chain_ref(self.conn, c["passport_fk"]), self.pdf(c),
                                 on_submitted=lambda h: record_submitted_tx(self.conn, c["id"], h))
        return reg


# ---------------------------------------------------------------------------------------------

class C01SuccessfulRegistration(Base):
    def test_sync_registers_confirms_reads_back_and_only_then_issues(self):
        t, res = self.sync(registrar=self.chain.registrar())
        self.assertEqual(res.summary["issued_registered"], 18)
        self.assertEqual(res.summary["issuance_failures"], 0)
        v = self.current()
        receipt = self.chain.w3.eth.get_transaction_receipt(v["chain_tx_hash"])
        self.assertEqual(receipt["status"], 1)
        self.assertEqual(receipt["blockNumber"], v["chain_block_number"])
        self.assertEqual(Web3.to_checksum_address(v["chain_contract"]), self.chain.registry)
        self.assertEqual(Web3.to_checksum_address(v["chain_issuer"]), self.chain.issuer)
        self.assertEqual(v["chain_issuer_test_only"], 1)
        rec = self.chain.contract.functions.getRecord(code_key(v["verification_code"])).call()
        self.assertEqual(rec[0].hex(), hashlib.sha256(self.pdf(v)).hexdigest(), "on-chain hash = SHA-256 of the stored file")
        self.assertEqual(rec[2], 1)
        fresh = next(r for r in t.rows if r.outputs.get("Passport Sync Status") == "NOT SYNCED")
        self.assertEqual(res.row_status[fresh.sheet_row]["Passport Sync Status"], "SYNCED")
        self.assertEqual(res.row_status[fresh.sheet_row]["Synced Passport Version"], "V1")

        verdict = verify(v["verification_code"], self.chain.anchor, RPC, self.pdf(v))
        self.assertEqual(verdict.status, VALID, verdict.messages)
        self.assertTrue(verdict.latest_version)
        self.assertFalse(verdict.official_btu_issuer)
        self.assertIn("TEST ISSUER", " ".join(verdict.messages))

    def test_no_personal_data_goes_on_chain(self):
        self.sync(registrar=self.chain.registrar())
        v = self.current()
        tx = self.chain.w3.eth.get_transaction(v["chain_tx_hash"])
        fn, args = self.chain.contract.decode_function_input(tx["input"])
        self.assertEqual(fn.fn_name, "register")
        self.assertEqual(set(args), {"codeKey", "passportRef", "versionNo", "pdfSha256"})
        p = self.one("SELECT p.*, s.email, s.student_id FROM passports p JOIN students s ON s.id = p.student_fk WHERE p.id = ?", v["passport_fk"])
        blob = bytes(tx["input"]) + b"".join(bytes(l["data"]) for l in self.chain.w3.eth.get_transaction_receipt(v["chain_tx_hash"])["logs"])
        for private in (p["holder_first_name"], p["holder_last_name"], p["email"], p["student_id"], p["passport_id"],
                        v["verification_code"]):
            self.assertNotIn(private.encode(), blob)
            self.assertNotIn(private.upper().encode(), blob)
        self.assertEqual(args["passportRef"].hex(), p["chain_ref"], "random reference, not derived from the Passport ID")


class C02TransactionFailures(Base):
    def test_unreachable_rpc_keeps_everything_waiting(self):
        _, res = self.sync(registrar=self.chain.registrar(rpc=f"http://127.0.0.1:{_free_port()}"))
        self.assertEqual(res.summary["issuance_failures"], 18)
        self.assertEqual(self.one("SELECT COUNT(*) FROM passport_versions")[0], 0)
        self.assertIn("RPC unreachable", self.cand()["last_registration_error"])

    def test_a_reverted_transaction_is_never_reported_as_success_and_is_retried(self):
        class LowGas(EvmRegistrar):
            def _send(self, key, ref, version_no, pdf_hash):  # mined, but runs out of gas: status 0
                fn = self.contract.functions.register(key, ref, version_no, pdf_hash)
                latest = self.w3.eth.get_block("latest")
                tx = fn.build_transaction({"from": self.address, "chainId": self.chain_id, "gas": 30_000,
                                           "nonce": self.w3.eth.get_transaction_count(self.address, "pending"),
                                           "maxPriorityFeePerGas": 10 ** 9, "maxFeePerGas": 2 * latest["baseFeePerGas"] + 10 ** 9})
                return self.w3.eth.send_raw_transaction(self._account.sign_transaction(tx).raw_transaction).to_0x_hex()
        low = LowGas(RPC, 31337, self.chain.registry, self.chain.issuer_key, confirmations=1, timeout_s=20, poll_s=0.05,
                     anchor=self.chain.anchor)
        c = self.cand()
        with self.assertRaisesRegex(RegistrationError, "failed on-chain"):
            self.register_one(low, c)
        failed_tx = self.one("SELECT chain_tx_submitted FROM version_candidates WHERE id = ?", c["id"])[0]
        self.assertEqual(self.chain.w3.eth.get_transaction_receipt(failed_tx)["status"], 0)
        self.assertIsNone(self.current())
        c = self.one("SELECT * FROM version_candidates WHERE id = ?", c["id"])
        reg = self.register_one(self.chain.registrar(), c)  # retry: the failed tx is not reused
        self.assertNotEqual(reg.tx_hash, failed_tx)
        issue_candidate(self.conn, c["id"], reg)
        self.assertEqual(self.current()["chain_tx_hash"], reg.tx_hash)

    def test_contract_refusal_is_reported_before_sending(self):
        c = self.cand()
        # the same PDF hash already registered under another code: the contract would refuse
        reg = self.chain.registrar()
        tx = reg.contract.functions.register(code_key("BTU-OTHE-RCOD-E000"), b"\x01" * 32, 1, bytes.fromhex(c["pdf_sha256"]))
        self.chain.w3.eth.wait_for_transaction_receipt(self._signed_send(tx))
        nonce = self.chain.nonce()
        with self.assertRaisesRegex(RegistrationError, "HashAlreadyRegistered|would fail"):
            self.register_one(reg, c)
        self.assertEqual(self.chain.nonce(), nonce, "no failing transaction was sent")

    def _signed_send(self, fn):
        w3, key = self.chain.w3, self.chain.issuer_key
        acct = w3.eth.account.from_key(key)
        latest = w3.eth.get_block("latest")
        tx = fn.build_transaction({"from": acct.address, "nonce": w3.eth.get_transaction_count(acct.address),
                                   "chainId": 31337, "gas": 300_000, "maxPriorityFeePerGas": 10 ** 9,
                                   "maxFeePerGas": 2 * latest["baseFeePerGas"] + 10 ** 9})
        return w3.eth.send_raw_transaction(acct.sign_transaction(tx).raw_transaction)


class C03RetryAndConfirmations(Base):
    def test_waits_for_confirmations_and_resumes_without_a_second_transaction(self):
        c = self.cand()
        slow = self.chain.registrar(confirmations=3, timeout_s=0.5)
        with self.assertRaisesRegex(RegistrationError, "1 of 3 confirmations"):
            self.register_one(slow, c)
        self.assertIsNone(self.current(), "not issued before it is confirmed")
        nonce = self.chain.nonce()
        self.chain.mine(2)
        c = self.one("SELECT * FROM version_candidates WHERE id = ?", c["id"])
        reg = self.register_one(slow, c)
        self.assertEqual(self.chain.nonce(), nonce, "no second transaction")
        self.assertEqual(reg.tx_hash, c["chain_tx_submitted"])
        self.assertGreaterEqual(reg.confirmations, 3)
        self.assertEqual(self.chain.registrations(c["verification_code"]), 1)

    def test_crash_after_registration_is_recovered_from_the_chain(self):
        c = self.cand()
        first = self.register_one(self.chain.registrar(), c)  # registered, but the issuing step never ran
        self.assertIsNone(self.current())
        nonce = self.chain.nonce()
        _, res = self.sync(registrar=self.chain.registrar())
        self.assertEqual(res.summary["issued_registered"], 18)
        self.assertEqual(self.chain.nonce(), nonce + 17, "the 17 others were sent; the recovered one was not resent")
        self.assertEqual(self.current()["chain_tx_hash"], first.tx_hash)
        self.assertEqual(self.chain.registrations(c["verification_code"]), 1)


class C04Duplicates(Base):
    def test_duplicate_submissions_are_refused_by_the_contract_and_never_sent_by_the_sync(self):
        self.sync(registrar=self.chain.registrar())
        v = self.current()
        fn = self.chain.contract.functions.register(code_key(v["verification_code"]), bytes.fromhex(self.one(
            "SELECT chain_ref FROM passports WHERE id = ?", v["passport_fk"])[0]), 2, b"\x02" * 32)
        with self.assertRaisesRegex(Exception, "AlreadyRegistered|revert"):
            fn.estimate_gas({"from": self.chain.issuer})
        nonce = self.chain.nonce()
        _, res = self.sync(registrar=self.chain.registrar())
        self.assertEqual((res.summary["versions_generated"], res.summary["issued_registered"]), (0, 0))
        self.assertEqual(self.chain.nonce(), nonce)

    def test_a_new_version_is_registered_and_the_old_one_reads_as_superseded(self):
        self.sync(registrar=self.chain.registrar())
        v1 = self.current()
        self.sync(with_new_skills("s4-v2", STUDENT1, "REC-0851"), registrar=self.chain.registrar())
        v2 = self.current()
        self.assertEqual(v2["version_no"], 2)
        old = verify(v1["verification_code"], self.chain.anchor, RPC, self.pdf(v1))
        new = verify(v2["verification_code"], self.chain.anchor, RPC, self.pdf(v2))
        self.assertEqual((old.status, old.latest_version), (VALID, False))
        self.assertIn("superseded", " ".join(old.messages))
        self.assertEqual((new.status, new.latest_version), (VALID, True))


class C05VerificationFailures(Base):
    def setUp(self):
        super().setUp()
        self.sync(registrar=self.chain.registrar())
        self.v = self.current()

    def test_unknown_version(self):
        self.assertEqual(verify("BTU-0000-0000-0000", self.chain.anchor, RPC).status, NOT_FOUND)

    def test_incorrect_hash(self):
        tampered = self.pdf(self.v) + b"\n%changed"
        self.assertEqual(verify(self.v["verification_code"], self.chain.anchor, RPC, tampered).status, HASH_MISMATCH)
        other = self.pdf(self.one("SELECT * FROM passport_versions WHERE id != ? LIMIT 1", self.v["id"]))
        self.assertEqual(verify(self.v["verification_code"], self.chain.anchor, RPC, other).status, HASH_MISMATCH)

    def test_registrar_refuses_a_stored_file_that_changed(self):
        path = with_new_skills("s4-changed", STUDENT1, "REC-0852")
        self.sync(path, registrar=None)
        c = self.cand()
        nonce = self.chain.nonce()
        with self.assertRaisesRegex(RegistrationError, "differs from the candidate"):
            self.chain.registrar().register(c, chain_ref(self.conn, c["passport_fk"]), self.pdf(c) + b"x")
        self.assertEqual(self.chain.nonce(), nonce)


class C06IssuerIdentity(Base):
    def test_an_issuer_not_authorised_on_chain_cannot_register(self):
        chain_admin.set_issuer(RPC, self.chain.registry, self.chain.admin_key, self.chain.issuer, active=False,
                               test_only=True, label="revoked")
        nonce = self.chain.nonce()
        _, res = self.sync(registrar=self.chain.registrar())
        self.assertEqual(res.summary["issuance_failures"], 18)
        self.assertIn("issuer mismatch", self.cand()["last_registration_error"])
        self.assertEqual(self.chain.nonce(), nonce)
        self.assertEqual(self.one("SELECT COUNT(*) FROM passport_versions")[0], 0)

    def test_an_issuer_missing_from_btus_trust_anchor_is_refused(self):
        anchor = dict(self.chain.anchor, issuers=[])
        _, res = self.sync(registrar=self.chain.registrar(anchor=anchor))
        self.assertEqual(res.summary["issuance_failures"], 18)
        self.assertIn("not listed in the BTU trust anchor", self.cand()["last_registration_error"])

    def test_records_from_issuers_btu_does_not_list_are_not_trusted(self):
        # the registry admin authorises an extra address that BTU's trust anchor does not name
        rogue_key = "0x" + secrets.token_hex(32)
        rogue = self.chain.fund(rogue_key)
        chain_admin.set_issuer(RPC, self.chain.registry, self.chain.admin_key, rogue, active=True, test_only=True, label="BTU")
        c = self.cand()
        reg = self.chain.registrar(key=rogue_key, anchor=None)  # no anchor check on the sending side
        self.register_one(reg, c)
        verdict = verify(c["verification_code"], self.chain.anchor, RPC, self.pdf(c))
        self.assertEqual(verdict.status, ISSUER_NOT_TRUSTED)

    def test_a_look_alike_registry_with_another_admin_is_not_trusted(self):
        fake = Chain(label="Business and Technology University (BTU)")
        c = self.cand()
        fake.registrar(anchor=None).register(c, chain_ref(self.conn, c["passport_fk"]), self.pdf(c))
        self.assertEqual(verify(c["verification_code"], self.chain.anchor, RPC).status, NOT_FOUND,
                         "BTU's anchor points at BTU's registry, so the look-alike's record is not found")
        spoofed = dict(self.chain.anchor, registry=fake.registry)  # registry swapped, admin still BTU's
        self.assertEqual(verify(c["verification_code"], spoofed, RPC).status, ISSUER_NOT_TRUSTED)

    def test_versions_registered_before_an_issuer_is_revoked_stay_valid(self):
        self.sync(registrar=self.chain.registrar())
        v = self.current()
        self.chain.mine(1)
        chain_admin.set_issuer(RPC, self.chain.registry, self.chain.admin_key, self.chain.issuer, active=False,
                               test_only=True, label="rotated out")
        self.assertEqual(verify(v["verification_code"], self.chain.anchor, RPC, self.pdf(v)).status, VALID)


if __name__ == "__main__":
    unittest.main()
