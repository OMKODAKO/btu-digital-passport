"""Blockchain registration of issued passport versions (PassportRegistry on an EVM network).

What goes on-chain per version: SHA-256 of the Verification Code (the lookup key), a random
per-passport reference, the version number, and the SHA-256 of the exact PDF bytes. Nothing personal.

EvmRegistrar.register() does, in order: re-hash the stored PDF, check the network, the contract and
that the signing address is an authorised issuer (on-chain and in BTU's trust anchor), submit the
transaction, wait for the receipt and the required confirmations, then read the record back and
compare every field. Only then does it return a Registration; anything else raises, and the caller
keeps the previous passport version current.
"""
from __future__ import annotations

import hashlib
import json
import os
import time
import urllib.request
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Callable, Protocol

from . import config


class RegistrationError(Exception):
    """Registration did not complete; nothing may be marked as issued."""


class AwaitingConfirmations(RegistrationError):
    """The transaction is mined but not yet confirmed enough; the next run continues with it."""


@dataclass(frozen=True)
class Registration:
    tx_hash: str
    network: str
    pdf_sha256: str        # the hash read back from the chain; must equal the candidate's
    registered_at: str     # block timestamp, ISO 8601 UTC
    chain_id: int = 0
    contract: str = ""
    block_number: int = 0
    block_hash: str = ""
    issuer: str = ""
    issuer_label: str = ""
    issuer_test_only: bool = True
    confirmations: int = 0


class Registrar(Protocol):
    def register(self, candidate, passport_ref: str, pdf_bytes: bytes,
                 on_submitted: Callable[[str], None] | None = None) -> Registration: ...


def code_key(verification_code: str) -> bytes:
    """On-chain lookup key: SHA-256 of the code, so codes can't be listed from the chain."""
    return hashlib.sha256(verification_code.encode("utf-8")).digest()


def load_artifact() -> dict:
    return json.loads(Path(config.CONTRACT_ARTIFACT).read_text())


def load_trust_anchor(source: str) -> dict:
    """BTU's published issuer statement (see chain/README.md). Path or https URL."""
    if source.startswith("https://"):
        with urllib.request.urlopen(source, timeout=15) as r:  # noqa: S310 (https only)
            return json.loads(r.read())
    return json.loads(Path(source).read_text())


def _iso(ts: int) -> str:
    return datetime.fromtimestamp(ts, timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _same(a: str, b: str) -> bool:
    return a.lower() == b.lower()


class EvmRegistrar:
    def __init__(self, rpc_url: str, chain_id: int, registry: str, private_key: str, *, network: str = "",
                 confirmations: int = 3, timeout_s: float = 180, anchor: dict | None = None,
                 min_priority_fee_gwei: float = 0.0, poll_s: float = 0.5):
        from web3 import Web3  # imported here so the rest of the worker runs without web3

        if not (rpc_url and chain_id and registry and private_key):
            raise RegistrationError("blockchain settings incomplete")
        self.w3 = Web3(Web3.HTTPProvider(rpc_url, request_kwargs={"timeout": 30}))
        self.chain_id, self.network = chain_id, network or f"chain {chain_id}"
        self.registry = Web3.to_checksum_address(registry)
        self.contract = self.w3.eth.contract(address=self.registry, abi=load_artifact()["abi"])
        self._account = self.w3.eth.account.from_key(private_key)  # key stays in memory only
        self.address = self._account.address
        self.confirmations, self.timeout_s, self.poll_s = max(1, confirmations), timeout_s, poll_s
        self.anchor = anchor
        self.min_priority_fee = Web3.to_wei(min_priority_fee_gwei, "gwei")

    def __repr__(self):  # never print the key
        return f"EvmRegistrar(network={self.network!r}, registry={self.registry}, issuer={self.address})"

    # ---------------------------------------------------------------- checks before sending

    def preflight(self) -> dict:
        try:
            chain_id = self.w3.eth.chain_id
        except Exception as exc:  # noqa: BLE001
            raise RegistrationError(f"RPC unreachable: {type(exc).__name__}") from exc
        if chain_id != self.chain_id:
            raise RegistrationError(f"connected to chain {chain_id}, expected {self.chain_id}")
        if len(self.w3.eth.get_code(self.registry)) == 0:
            raise RegistrationError(f"no contract at {self.registry}")
        issuer = self.contract.functions.issuer(self.address).call()
        active, test_only, _authorised, _revoked, label = issuer
        if not active:
            raise RegistrationError(f"issuer mismatch: {self.address} is not an authorised issuer in the registry")
        if self.anchor is not None:
            self._check_anchor()
        return {"label": label, "test_only": test_only}

    def _check_anchor(self):
        a = self.anchor
        admin = self.contract.functions.admin().call()
        if int(a.get("chain_id", 0)) != self.chain_id or not _same(a.get("registry", ""), self.registry):
            raise RegistrationError("issuer mismatch: the BTU trust anchor names a different network or registry")
        if not _same(a.get("registry_admin", ""), admin):
            raise RegistrationError("issuer mismatch: registry admin differs from the BTU trust anchor")
        if not any(_same(i.get("address", ""), self.address) for i in a.get("issuers", [])):
            raise RegistrationError(f"issuer mismatch: {self.address} is not listed in the BTU trust anchor")

    # ---------------------------------------------------------------- registration

    def register(self, candidate, passport_ref: str, pdf_bytes: bytes,
                 on_submitted: Callable[[str], None] | None = None) -> Registration:
        digest = hashlib.sha256(pdf_bytes).hexdigest()
        if digest != candidate["pdf_sha256"]:
            raise RegistrationError("the stored PDF's SHA-256 differs from the candidate's; not registered")
        info = self.preflight()
        key = code_key(candidate["verification_code"])
        ref = bytes.fromhex(passport_ref)
        version_no = int(candidate["version_no"])
        pdf_hash = bytes.fromhex(digest)

        existing = self.contract.functions.getRecord(key).call()
        if existing[4] != 0:  # already on-chain: a retry after a crash, or a conflict
            self._expect(existing, pdf_hash, ref, version_no)
            tx_hash = self._find_registration_tx(key)
        else:
            tx_hash = self._previous_tx_if_pending(candidate)
            if tx_hash is None:
                tx_hash = self._send(key, ref, version_no, pdf_hash)
                if on_submitted:
                    on_submitted(tx_hash)
        receipt = self._await_receipt(tx_hash)
        confirmations = self._await_confirmations(receipt["blockNumber"], tx_hash)

        record = self.contract.functions.getRecord(key).call()  # read back what the chain now says
        self._expect(record, pdf_hash, ref, version_no)
        block = self.w3.eth.get_block(receipt["blockNumber"])
        return Registration(
            tx_hash=tx_hash, network=self.network, pdf_sha256=record[0].hex(), registered_at=_iso(record[4]),
            chain_id=self.chain_id, contract=self.registry, block_number=receipt["blockNumber"],
            block_hash=block["hash"].hex(), issuer=record[3], issuer_label=info["label"],
            issuer_test_only=info["test_only"], confirmations=confirmations)

    def _expect(self, record, pdf_hash: bytes, ref: bytes, version_no: int):
        pdf, rec_ref, rec_version, rec_issuer, registered_at, _block = record
        if registered_at == 0:
            raise RegistrationError("read-back failed: no record for this verification code")
        problems = []
        if pdf != pdf_hash:
            problems.append("PDF hash")
        if rec_ref != ref:
            problems.append("passport reference")
        if rec_version != version_no:
            problems.append("version number")
        if not _same(rec_issuer, self.address):
            problems.append(f"issuer ({rec_issuer})")
        if problems:
            raise RegistrationError(f"on-chain record for this code differs in: {', '.join(problems)}")

    def _previous_tx_if_pending(self, candidate) -> str | None:
        """A transaction sent on an earlier run that is still pending is waited for, not sent again."""
        prev = candidate["chain_tx_submitted"] if "chain_tx_submitted" in candidate.keys() else None
        if not prev:
            return None
        try:
            receipt = self.w3.eth.get_transaction_receipt(prev)
        except Exception:  # noqa: BLE001 (not mined yet, or unknown)
            receipt = None
        if receipt is not None:
            return None if receipt["status"] != 1 else prev  # failed earlier: send a new one
        try:
            self.w3.eth.get_transaction(prev)
            return prev  # still pending in the node: keep waiting for it
        except Exception:  # noqa: BLE001
            return None  # dropped: send again

    def _send(self, key: bytes, ref: bytes, version_no: int, pdf_hash: bytes) -> str:
        fn = self.contract.functions.register(key, ref, version_no, pdf_hash)
        try:
            gas = fn.estimate_gas({"from": self.address})  # reverts here if the contract would refuse
        except Exception as exc:  # noqa: BLE001
            raise RegistrationError(f"transaction would fail: {exc}") from exc
        latest = self.w3.eth.get_block("latest")
        tip = max(self.w3.eth.max_priority_fee, self.min_priority_fee)
        tx = fn.build_transaction({
            "from": self.address, "chainId": self.chain_id, "gas": int(gas * 1.25),
            "nonce": self.w3.eth.get_transaction_count(self.address, "pending"),
            "maxPriorityFeePerGas": tip, "maxFeePerGas": 2 * latest["baseFeePerGas"] + tip,
        })
        signed = self._account.sign_transaction(tx)
        try:
            return self.w3.eth.send_raw_transaction(signed.raw_transaction).to_0x_hex()
        except Exception as exc:  # noqa: BLE001
            raise RegistrationError(f"transaction rejected by the node: {exc}") from exc

    def _await_receipt(self, tx_hash: str):
        try:
            receipt = self.w3.eth.wait_for_transaction_receipt(tx_hash, timeout=self.timeout_s, poll_latency=self.poll_s)
        except Exception as exc:  # noqa: BLE001
            raise AwaitingConfirmations(f"transaction {tx_hash} not mined within {self.timeout_s:.0f}s") from exc
        if receipt["status"] != 1:
            raise RegistrationError(f"transaction {tx_hash} failed on-chain (status 0)")
        return receipt

    def _await_confirmations(self, block_number: int, tx_hash: str) -> int:
        deadline = time.monotonic() + self.timeout_s
        while True:
            confs = self.w3.eth.block_number - block_number + 1
            if confs >= self.confirmations:
                return confs
            if time.monotonic() > deadline:
                raise AwaitingConfirmations(
                    f"transaction {tx_hash} has {confs} of {self.confirmations} confirmations; will check again next run")
            time.sleep(self.poll_s)

    def _find_registration_tx(self, key: bytes) -> str:
        event = self.contract.events.VersionRegistered()
        # Public RPCs cap the block range, so start at the registry's deployment block when it is known.
        from_block = int(os.environ.get("PASSPORT_REGISTRY_FROM_BLOCK", "0") or 0)
        logs = event.get_logs(from_block=from_block, argument_filters={"codeKey": key})
        if not logs:
            raise RegistrationError("record exists but its registration transaction was not found")
        return logs[0]["transactionHash"].to_0x_hex()


def configured_registrar() -> Registrar | None:
    """The real registrar when the network, registry and issuer key are configured; otherwise None
    (candidates wait). There is deliberately no stand-in that pretends to register."""
    key = os.environ.get("PASSPORT_ISSUER_PRIVATE_KEY", "")
    if not (config.CHAIN_RPC_URL and config.CHAIN_ID and config.REGISTRY_ADDRESS and key):
        return None
    anchor = load_trust_anchor(config.TRUST_ANCHOR) if config.TRUST_ANCHOR else None
    return EvmRegistrar(config.CHAIN_RPC_URL, config.CHAIN_ID, config.REGISTRY_ADDRESS, key,
                        network=config.CHAIN_NETWORK, confirmations=config.CHAIN_CONFIRMATIONS,
                        timeout_s=config.CHAIN_TIMEOUT_S, anchor=anchor,
                        min_priority_fee_gwei=config.CHAIN_MIN_PRIORITY_FEE_GWEI)
