"""Test fixture: an address authorised in the registry, but not listed in BTU's trust anchor, registers a
record for a made-up code. usage: rogue_register.py <rpc> <registry> <code> <file>  (key in ROGUE_KEY env)"""
import hashlib
import os
import sys
from pathlib import Path

from web3 import Web3

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from worker.chain import code_key, load_artifact

rpc, registry, code, path = sys.argv[1:5]
w3 = Web3(Web3.HTTPProvider(rpc))
acct = w3.eth.account.from_key(os.environ["ROGUE_KEY"])
c = w3.eth.contract(address=Web3.to_checksum_address(registry), abi=load_artifact()["abi"])
digest = hashlib.sha256(open(path, "rb").read()).digest()
tx = c.functions.register(code_key(code), os.urandom(32), 1, digest).build_transaction(
    {"from": acct.address, "nonce": w3.eth.get_transaction_count(acct.address), "chainId": w3.eth.chain_id})
receipt = w3.eth.wait_for_transaction_receipt(w3.eth.send_raw_transaction(acct.sign_transaction(tx).raw_transaction))
assert receipt["status"] == 1, "rogue registration failed"
print(receipt["transactionHash"].hex())
