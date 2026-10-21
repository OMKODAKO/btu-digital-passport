"""Checks a passport version against the chain and BTU's trust anchor. Needs no database: anyone with
the code (and optionally the PDF) can run the same checks against the public chain.

Steps: find the record for the code; compare the PDF's SHA-256 with it; confirm the registry is the
one BTU's trust anchor names, with the admin it names; confirm the record's issuer is listed by BTU and
was authorised in the registry when the record was written; report whether this is the latest version
and whether the issuer is a test issuer.
"""
from __future__ import annotations

import hashlib
from dataclasses import asdict, dataclass, field

from .chain import _iso, _same, code_key, load_artifact

VALID, NOT_FOUND, HASH_MISMATCH, ISSUER_NOT_TRUSTED, ERROR = (
    "VALID", "NOT_FOUND", "HASH_MISMATCH", "ISSUER_NOT_TRUSTED", "ERROR")


@dataclass
class Verdict:
    status: str
    messages: list[str] = field(default_factory=list)
    version_no: int | None = None
    latest_version: bool | None = None
    registered_at: str | None = None
    block_number: int | None = None
    issuer: str | None = None
    issuer_label: str | None = None
    official_btu_issuer: bool = False
    pdf_sha256: str | None = None

    def as_dict(self):
        return asdict(self)


def verify(code: str, anchor: dict, rpc_url: str, pdf_bytes: bytes | None = None) -> Verdict:
    from web3 import Web3

    try:
        w3 = Web3(Web3.HTTPProvider(rpc_url, request_kwargs={"timeout": 30}))
        if w3.eth.chain_id != int(anchor["chain_id"]):
            return Verdict(ERROR, ["the RPC endpoint is on a different chain than BTU's trust anchor names"])
        registry = w3.eth.contract(address=Web3.to_checksum_address(anchor["registry"]), abi=load_artifact()["abi"])
        if len(w3.eth.get_code(registry.address)) == 0:
            return Verdict(ERROR, ["no registry contract at the address BTU's trust anchor names"])
        rec = registry.functions.getRecord(code_key(code.strip().upper())).call()
        pdf, ref, version_no, issuer, registered_at, block_number = rec
        if registered_at == 0:
            return Verdict(NOT_FOUND, ["no issued passport version has this verification code"])

        v = Verdict(VALID, version_no=version_no, registered_at=_iso(registered_at), block_number=block_number,
                    issuer=issuer, pdf_sha256=pdf.hex())
        versions = registry.functions.versionsOf(ref).call()
        v.latest_version = bool(versions) and versions[-1] == code_key(code.strip().upper())
        if not v.latest_version:
            v.messages.append("authentic, but superseded by a later version of this passport")

        listed = next((i for i in anchor.get("issuers", []) if _same(i.get("address", ""), issuer)), None)
        active, test_only, authorised_at, revoked_at, label = registry.functions.issuer(issuer).call()
        v.issuer_label = label
        trusted = (
            _same(registry.functions.admin().call(), anchor.get("registry_admin", ""))
            and listed is not None
            and authorised_at != 0 and authorised_at <= registered_at
            and (revoked_at == 0 or registered_at < revoked_at)
        )
        if not trusted:
            v.status = ISSUER_NOT_TRUSTED
            v.messages.append("the record was not written by an issuer that BTU's trust anchor and registry authorise")
        v.official_btu_issuer = bool(trusted and not test_only and not listed.get("test_only", True)
                                     and anchor.get("status") == "OFFICIAL")
        if trusted and not v.official_btu_issuer:
            v.messages.append("TEST ISSUER: official BTU issuer verification is still pending")

        if pdf_bytes is not None and hashlib.sha256(pdf_bytes).hexdigest() != v.pdf_sha256:
            v.status = HASH_MISMATCH
            v.messages.append("the PDF differs from the issued file (its SHA-256 does not match the on-chain record)")
        return v
    except Exception as exc:  # noqa: BLE001
        return Verdict(ERROR, [f"verification could not be completed: {type(exc).__name__}"])
