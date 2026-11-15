import fs from "node:fs";

import { qorechainTestnet } from "@qorechain/evm";
import { createPublicClient, http, type Hex } from "viem";

import { parseBundle } from "../src/lib/patch3q";

const REST = process.env.PATCH3Q_REST ?? "https://api-testnet.qore.host";
const evidence = JSON.parse(fs.readFileSync("evidence/testnet.json", "utf8"));
const client = createPublicClient({ chain: qorechainTestnet, transport: http(qorechainTestnet.rpcUrls.default.http[0]) });

type Row = { step: string; hash: string; gasUsed: number; block: number; timestamp: number };

async function evmRow(step: string, hash: string): Promise<Row> {
  const receipt = await client.getTransactionReceipt({ hash: hash as Hex });
  const block = await client.getBlock({ blockNumber: receipt.blockNumber });
  return { step, hash, gasUsed: Number(receipt.gasUsed), block: Number(receipt.blockNumber), timestamp: Number(block.timestamp) };
}

async function main(): Promise<void> {
  const evm: Row[] = [
    await evmRow("deploy MockTUSDT", evidence.evm.tokenDeployment.hash),
    await evmRow("deploy Patch3QRegistry", evidence.evm.registryDeployment.hash),
  ];
  for (const [name, entry] of Object.entries<any>(evidence.cases)) {
    for (const [method, ref] of Object.entries<any>(entry.transactions)) evm.push(await evmRow(`${name}.${method}`, ref.hash));
  }

  const native: { step: string; hash: string; gasUsed: number; height: number }[] = [];
  for (const [step, ref] of Object.entries<any>(evidence.native)) {
    if (!/^[0-9A-F]{64}$/u.test(ref.hash)) continue;
    const body = await (await fetch(`${REST}/cosmos/tx/v1beta1/txs/${ref.hash}`)).json() as { tx_response: { gas_used: string; height: string } };
    native.push({ step, hash: ref.hash, gasUsed: Number(body.tx_response.gas_used), height: Number(body.tx_response.height) });
  }

  const cases = Object.fromEntries(Object.entries<any>(evidence.cases).map(([name, entry]) => {
    const bundle = parseBundle(fs.readFileSync(entry.bundle, "utf8"));
    const rows = evm.filter((row) => row.step.startsWith(`${name}.`));
    return [name, {
      bundleFileBytes: fs.statSync(entry.bundle).size,
      envelopeTextBytes: bundle.envelope.length,
      sizeBucket: bundle.privacy.sizeBucket,
      transactions: rows.length,
      totalGas: rows.reduce((sum, row) => sum + row.gasUsed, 0),
      firstToLastSeconds: rows.at(-1)!.timestamp - rows[0].timestamp,
    }];
  }));

  const byStep = (step: string) => evm.find((row) => row.step === step)!;
  const normal = byStep("normal.approveAnonymousSeverity");
  const escalated = byStep("ghosted.approveAnonymousSeverity");
  const result = {
    measuredAt: new Date().toISOString(),
    dianaBlock: (await client.getBlockNumber()).toString(),
    registryRuntimeBytes: ((await client.getCode({ address: evidence.registryAddress }))!.length - 2) / 2,
    dualPqReleaseGas: { normal: normal.gasUsed, escalated: escalated.gasUsed },
    escalationGas: byStep("ghosted.escalateMissedDeadline").gasUsed,
    relayerAnchorGas: byStep("normal.submitAnonymousCase").gasUsed,
    ghostedDeadlineToEscalationSeconds:
      byStep("ghosted.escalateMissedDeadline").timestamp - Math.floor(Date.parse(parseBundle(fs.readFileSync(evidence.cases.ghosted.bundle, "utf8")).publicMetadata.acknowledgeBy) / 1000),
    cases,
    evm,
    native,
  };
  fs.writeFileSync("evidence/measurements.json", JSON.stringify(result, null, 2) + "\n");

  console.log("| Step | Gas used |\n| --- | ---: |");
  for (const row of evm) console.log(`| ${row.step} | ${row.gasUsed.toLocaleString("en-US")} |`);
  for (const row of native) console.log(`| native ${row.step} | ${row.gasUsed.toLocaleString("en-US")} |`);
  console.log(JSON.stringify({ ...result, evm: undefined, native: undefined }, null, 2));
}

await main();
