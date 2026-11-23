import fs from "node:fs";
import path from "node:path";
import solc from "solc";

const root = process.cwd();
const sourceFiles = ["Patch3QRegistry.sol", "Patch3QRegistryV4.sol"];
const sources = Object.fromEntries(sourceFiles.map((filename) => [
  filename,
  { content: fs.readFileSync(path.join(root, "contracts", filename), "utf8") },
]));
const input = {
  language: "Solidity",
  sources,
  settings: {
    optimizer: { enabled: true, runs: 200 },
    viaIR: true,
    outputSelection: { "*": { "*": ["abi", "evm.bytecode.object", "evm.deployedBytecode.object"] } },
  },
};
const output = JSON.parse(solc.compile(JSON.stringify(input)));
const errors = (output.errors ?? []).filter((entry) => entry.severity === "error");
if (errors.length > 0) {
  for (const error of errors) process.stderr.write(error.formattedMessage + "\n");
  process.exit(1);
}
const artifactDirectory = path.join(root, "artifacts");
fs.mkdirSync(artifactDirectory, { recursive: true });
for (const { contractName, sourceName } of [
  { contractName: "Patch3QRegistry", sourceName: "Patch3QRegistry.sol" },
  { contractName: "MockTUSDT", sourceName: "Patch3QRegistry.sol" },
  { contractName: "Patch3QRegistryV4", sourceName: "Patch3QRegistryV4.sol" },
]) {
  const contract = output.contracts[sourceName][contractName];
  fs.writeFileSync(
    path.join(artifactDirectory, contractName + ".json"),
    JSON.stringify(
      {
        contractName,
        sourceName: `contracts/${sourceName}`,
        compiler: solc.version(),
        abi: contract.abi,
        bytecode: "0x" + contract.evm.bytecode.object,
        deployedBytecode: "0x" + contract.evm.deployedBytecode.object,
      },
      null,
      2,
    ),
  );
}
process.stdout.write("Compiled Patch3QRegistry, Patch3QRegistryV4 and MockTUSDT with " + solc.version() + "\n");
