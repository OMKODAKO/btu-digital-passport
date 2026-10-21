"""Registry administration: deploy the contract, authorise or revoke issuers, write the trust anchor.

Keys come only from environment variables (PASSPORT_ADMIN_PRIVATE_KEY for the registry admin,
PASSPORT_ISSUER_PRIVATE_KEY for the issuer); they are never printed or written to disk. In production
the admin is a BTU-controlled multisig and these calls are made through it instead.
"""
from __future__ import annotations

import json
import os
from pathlib import Path

from .chain import RegistrationError, load_artifact


def _w3(rpc_url: str):
    from web3 import Web3
    return Web3(Web3.HTTPProvider(rpc_url, request_kwargs={"timeout": 30}))


def _send(w3, account, tx: dict) -> dict:
    tx.setdefault("nonce", w3.eth.get_transaction_count(account.address, "pending"))
    tx.setdefault("chainId", w3.eth.chain_id)
    tx["gas"] = int(w3.eth.estimate_gas(tx) * 1.25)
    tip = w3.eth.max_priority_fee
    tx.update(maxPriorityFeePerGas=tip, maxFeePerGas=2 * w3.eth.get_block("latest")["baseFeePerGas"] + tip)
    receipt = w3.eth.wait_for_transaction_receipt(
        w3.eth.send_raw_transaction(account.sign_transaction(tx).raw_transaction), timeout=180)
    if receipt["status"] != 1:
        raise RegistrationError(f"transaction {receipt['transactionHash'].to_0x_hex()} failed on-chain")
    return receipt


def deploy(rpc_url: str, admin_key: str) -> dict:
    w3 = _w3(rpc_url)
    admin = w3.eth.account.from_key(admin_key)
    art = load_artifact()
    c = w3.eth.contract(abi=art["abi"], bytecode=art["bytecode"])
    receipt = _send(w3, admin, c.constructor(admin.address).build_transaction({"from": admin.address}))
    return {"registry": receipt["contractAddress"], "admin": admin.address, "chain_id": w3.eth.chain_id,
            "tx_hash": receipt["transactionHash"].to_0x_hex(), "block_number": receipt["blockNumber"]}


def set_issuer(rpc_url: str, registry: str, admin_key: str, issuer: str, *, active: bool, test_only: bool, label: str) -> dict:
    from web3 import Web3
    w3 = _w3(rpc_url)
    admin = w3.eth.account.from_key(admin_key)
    c = w3.eth.contract(address=Web3.to_checksum_address(registry), abi=load_artifact()["abi"])
    fn = c.functions.setIssuer(Web3.to_checksum_address(issuer), active, test_only, label)
    receipt = _send(w3, admin, fn.build_transaction({"from": admin.address}))
    return {"tx_hash": receipt["transactionHash"].to_0x_hex(), "block_number": receipt["blockNumber"]}


def trust_anchor(chain_id: int, network: str, registry: str, admin: str, issuers: list[dict], *, official: bool = False) -> dict:
    """The statement BTU publishes at https://<btu domain>/.well-known/btu-passport-issuer.json.
    Its authority comes from being served on BTU's own domain; a copy anywhere else proves nothing."""
    return {
        "schema": "btu-passport-issuer/1",
        "issuer_name": "Business and Technology University (BTU)",
        "status": "OFFICIAL" if official else "TEST",
        "statement": ("Official BTU issuer for AI Skills Digital Passports." if official else
                      "TEST ISSUER for the BTU hackathon prototype. Not authorised by BTU; "
                      "official BTU issuer verification is pending."),
        "chain_id": chain_id,
        "network": network,
        "registry": registry,
        "registry_admin": admin,
        "issuers": issuers,
    }


def main(argv) -> int:
    import argparse

    ap = argparse.ArgumentParser(prog="python3 -m worker chain")
    sub = ap.add_subparsers(dest="cmd", required=True)
    d = sub.add_parser("deploy", help="deploy PassportRegistry (admin key from PASSPORT_ADMIN_PRIVATE_KEY)")
    d.add_argument("--rpc", required=True)
    s = sub.add_parser("set-issuer", help="authorise or revoke an issuer address")
    s.add_argument("--rpc", required=True)
    s.add_argument("--registry", required=True)
    s.add_argument("--issuer", required=True, help="issuer address (0x...)")
    s.add_argument("--label", required=True)
    s.add_argument("--revoke", action="store_true")
    s.add_argument("--official", action="store_true", help="mark as non-test; only for BTU's authorised production issuer")
    a = sub.add_parser("anchor", help="write a trust-anchor file for the registry")
    a.add_argument("--chain-id", type=int, required=True)
    a.add_argument("--network", required=True)
    a.add_argument("--registry", required=True)
    a.add_argument("--admin", required=True)
    a.add_argument("--issuer", action="append", required=True, help="address=label (repeatable)")
    a.add_argument("--out", required=True)
    args = ap.parse_args(argv)

    if args.cmd == "deploy":
        print(json.dumps(deploy(args.rpc, os.environ["PASSPORT_ADMIN_PRIVATE_KEY"]), indent=2))
    elif args.cmd == "set-issuer":
        print(json.dumps(set_issuer(args.rpc, args.registry, os.environ["PASSPORT_ADMIN_PRIVATE_KEY"], args.issuer,
                                    active=not args.revoke, test_only=not args.official, label=args.label), indent=2))
    else:
        issuers = [{"address": x.split("=", 1)[0], "label": x.split("=", 1)[1], "test_only": True} for x in args.issuer]
        Path(args.out).write_text(json.dumps(trust_anchor(args.chain_id, args.network, args.registry, args.admin, issuers),
                                             indent=2) + "\n")
        print(f"wrote {args.out} (status TEST)")
    return 0
