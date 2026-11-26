import { fetchEvmWindow } from "@qorechain/sdk";
import { actors, evmWrite, openWindow, publicClient as client, readJson, REST } from "./lib/v5-testnet.js";

const deployment = readJson("evidence/v5-deployment.json");
const abi = readJson(deployment.artifact).abi;
const registry = deployment.registryAddress;
const block = await client.getBlock();
const ids = new Set<`0x${string}`>();
for (let from = BigInt(deployment.deploymentBlock); from <= block.number; from += 9000n) {
  const to = from + 8999n < block.number ? from + 8999n : block.number;
  const events = await client.getContractEvents({ address: registry, abi, eventName: "FundedAnonymousCaseSubmitted", fromBlock: from, toBlock: to });
  for (const event of events) ids.add((event.args as any).caseIdHash);
}
const eligible = [];
for (const id of ids) {
  const state = await client.readContract({ address: registry, abi, functionName: "caseState", args: [id] }) as any;
  let deadline: bigint | undefined;
  if (state[0] === 0) deadline = state[4];
  if (state[0] === 1) deadline = state[5];
  if ((state[0] === 2 || state[0] === 3) && /^0x0{64}$/u.test(state[9])) {
    deadline = (await client.readContract({ address: registry, abi, functionName: "decisionState", args: [id] }) as any)[0];
  }
  if (deadline !== undefined && block.timestamp > deadline) eligible.push({ id, status: Number(state[0]), deadline: deadline.toString() });
}
const broadcast = process.argv.includes("--broadcast");
const results = [];
if (broadcast && eligible.length) {
  const { relayer } = await actors();
  const window = await fetchEvmWindow({ rest: REST, address: relayer.cosmos });
  if (!window.live || BigInt(window.remainingTxs ?? 0) < BigInt(eligible.length)) await openWindow(relayer, [registry], BigInt(eligible.length + 1));
  for (const entry of eligible) results.push({ ...entry,
    ...await evmWrite(relayer, { address: registry, abi, functionName: "escalateMissedDeadline", args: [entry.id] }) });
}
console.log(JSON.stringify({ network: "qorechain-diana", registry, scannedCases: ids.size, scannedTo: block.number.toString(), eligible, broadcast, results }, null, 2));
