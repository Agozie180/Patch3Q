import { closeEvmWindowMsg, fetchEvmWindow, fetchPqcStatus, isRegisteredPqcKey, pqcStatusPublicKey, unifiedAccountFromSeed } from "@qorechain/sdk";
import { hexToBytes, sha256 } from "viem";
import { actors, nativeWrite, pause, publicClient, readJson, REST, wallet, writeJson } from "./lib/v5-testnet.js";

const { program, relayer } = await actors();
const evidence = readJson("evidence/v5-lifecycle.json");
const local = readJson(".patch3q-testnet/v5-live/state.json");
const secrets = readJson(".patch3q-testnet/v5-live/secrets.json");
const result: any = { checkedAt: new Date().toISOString(), operators: {}, recipients: {} };
for (const [name, account] of [["program", program], ["relayer", relayer]] as const) {
  if ((await fetchEvmWindow({ rest: REST, address: account.cosmos })).live) {
    const ref = await nativeWrite(account, [closeEvmWindowMsg(account.cosmos)]);
    evidence.native[`${name}WindowClosed`] = ref; local.native[`${name}WindowClosed`] = ref;
    await pause(2000);
  }
  const status = await fetchEvmWindow({ rest: REST, address: account.cosmos });
  if (status.live) throw new Error("An operator EVM window is still live after finalization.");
  result.operators[name] = { address: account.evm, qor: account.cosmos, evmWindowClosed: true };
}
const tokenAbi = readJson("artifacts/MockTUSDT.json").abi;
for (const [name, entry] of Object.entries(evidence.cases) as [string, any][]) {
  if (!entry.payoutAmount) continue;
  const secret = secrets.recipients[name];
  const account = unifiedAccountFromSeed(hexToBytes(secret.privateKey), { recoveryCode: secret.recoveryCode });
  const pq = await fetchPqcStatus({ rest: REST, address: account.cosmos });
  const window = await fetchEvmWindow({ rest: REST, address: account.cosmos });
  if (!isRegisteredPqcKey(pq, account.pqc.publicKey) || window.live) throw new Error("Payout recipient PQ registration or closed-window check failed.");
  let rejected = false;
  let rejection = "";
  try {
    // A one-unit self-transfer preserves the bounty even if a node unexpectedly accepts it.
    const hash = await wallet(account).writeContract({ address: evidence.bountyTokenAddress, abi: tokenAbi,
      functionName: "transfer", args: [account.evm, 1n], gas: 100_000n } as any);
    await publicClient.waitForTransactionReceipt({ hash });
  } catch (error) {
    const message = String(error);
    rejection = message.split(/\r?\n/u).filter((line) => /window|authori[sz]ation|hybrid.*required/iu.test(line))
      .map((line) => line.replace(/0x[0-9a-f]{64,}/giu, "[transaction data]")).join(" ").slice(0, 1000);
    rejected = /no (?:active|open).*evm.*window|evm.*window.*(closed|expired|required|not.*open)|hybrid.*required/iu.test(rejection);
    if (!rejected) console.log("Recipient transfer diagnostic: " + rejection);
  }
  if (!rejected) throw new Error("The node did not explicitly reject a recipient's classical-only transfer.");
  result.recipients[name] = { address: account.evm, qor: account.cosmos, registeredPqKeyHash: sha256(pqcStatusPublicKey(pq)!),
    evmWindowClosed: true, classicalOnlyTransferRejected: true, rejection };
}
result.blockNumber = (await publicClient.getBlockNumber({ cacheTime: 0 })).toString();
writeJson("evidence/v5-recipient-security.json", result);
writeJson("evidence/v5-lifecycle.json", evidence); writeJson(".patch3q-testnet/v5-live/state.json", local);
console.log("V5 finalized: operator EVM windows closed; all three paid recipients are PQ registered with closed windows, and classical-only transfers were rejected.");
