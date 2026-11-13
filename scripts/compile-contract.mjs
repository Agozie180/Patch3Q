import fs from "node:fs";
import path from "node:path";
import solc from "solc";

const root = process.cwd();
const sourcePath = path.join(root, "contracts", "Patch3QRegistry.sol");
const source = fs.readFileSync(sourcePath, "utf8");
const input = {
  language: "Solidity",
  sources: { "Patch3QRegistry.sol": { content: source } },
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
for (const contractName of ["Patch3QRegistry", "MockTUSDT"]) {
  const contract = output.contracts["Patch3QRegistry.sol"][contractName];
  fs.writeFileSync(
    path.join(artifactDirectory, contractName + ".json"),
    JSON.stringify(
      {
        contractName,
        sourceName: "contracts/Patch3QRegistry.sol",
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
process.stdout.write("Compiled Patch3QRegistry and MockTUSDT with " + solc.version() + "\n");
