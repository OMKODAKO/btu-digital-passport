// Compiles contracts/PassportRegistry.sol with the pinned solc (npm "solc" 0.8.28) into
// build/PassportRegistry.json (ABI + bytecode). The Python worker reads only that file.
import fs from "node:fs";
import solc from "solc";

const source = fs.readFileSync("contracts/PassportRegistry.sol", "utf8");
const input = {
  language: "Solidity",
  sources: { "PassportRegistry.sol": { content: source } },
  settings: {
    optimizer: { enabled: true, runs: 200 },
    evmVersion: "paris",
    outputSelection: { "*": { "*": ["abi", "evm.bytecode.object", "evm.deployedBytecode.object"] } },
  },
};
const out = JSON.parse(solc.compile(JSON.stringify(input)));
const errors = (out.errors ?? []).filter((e) => e.severity === "error");
for (const e of out.errors ?? []) console.error(e.formattedMessage);
if (errors.length) process.exit(1);
const c = out.contracts["PassportRegistry.sol"].PassportRegistry;
fs.mkdirSync("build", { recursive: true });
fs.writeFileSync(
  "build/PassportRegistry.json",
  JSON.stringify(
    {
      contractName: "PassportRegistry",
      compiler: `solc ${solc.version()}`,
      settings: { optimizer: input.settings.optimizer, evmVersion: input.settings.evmVersion },
      abi: c.abi,
      bytecode: "0x" + c.evm.bytecode.object,
      deployedBytecode: "0x" + c.evm.deployedBytecode.object,
    },
    null,
    2,
  ) + "\n",
);
console.log(`compiled PassportRegistry with solc ${solc.version()} -> build/PassportRegistry.json`);
