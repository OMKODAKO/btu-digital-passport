// Local devnet only (npm run devnet): a real EVM JSON-RPC node on 127.0.0.1:8545, chain id 31337.
// Accounts used by the tests are generated fresh and funded through the node; none are configured here.
module.exports = {
  solidity: "0.8.28",
  // throwOnTransactionFailures: false makes a reverted transaction behave as on a public network: it is
  // mined with status 0 and the caller must read the receipt to find out.
  networks: { hardhat: { chainId: 31337, mining: { auto: true }, throwOnTransactionFailures: false } },
};
