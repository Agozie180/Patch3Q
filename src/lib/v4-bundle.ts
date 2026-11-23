import { qorechainTestnet } from "@qorechain/evm";
import { createPublicClient, hexToBytes, http, sha256 as viemSha256, type Address } from "viem";

import { patch3qRegistryV4Abi } from "../contract.js";
import type { Patch3QBundle } from "../types.js";
import { bytesToHex, fromUtf8, utf8 } from "./encoding.js";
import { hashText, parseBundle } from "./patch3q.js";

const publicClient = createPublicClient({ chain: qorechainTestnet, transport: http(qorechainTestnet.rpcUrls.default.http[0]) });

async function gzip(value: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([Uint8Array.from(value).buffer]).stream().pipeThrough(new CompressionStream("gzip"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function gunzip(value: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([Uint8Array.from(value).buffer]).stream().pipeThrough(new DecompressionStream("gzip"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

export async function v4BundleBytes(bundle: Patch3QBundle): Promise<Uint8Array> {
  return gzip(utf8(JSON.stringify(bundle)));
}

export async function v4BundleHex(bundle: Patch3QBundle): Promise<`0x${string}`> {
  return bytesToHex(await v4BundleBytes(bundle));
}

export async function parseV4BundleBytes(value: Uint8Array): Promise<Patch3QBundle> {
  const decoded = value[0] === 0x1f && value[1] === 0x8b ? await gunzip(value) : value;
  return parseBundle(fromUtf8(decoded));
}

export async function fetchV4Bundle(options: {
  registryAddress: Address;
  caseId: string;
  fromBlock?: bigint;
}): Promise<{ bundle: Patch3QBundle; bundleHash: `0x${string}`; transactionHash?: `0x${string}` }> {
  const caseIdHash = await hashText(options.caseId);
  const events = await publicClient.getContractEvents({
    address: options.registryAddress,
    abi: patch3qRegistryV4Abi,
    eventName: "EncryptedBundlePublished",
    args: { caseIdHash },
    fromBlock: options.fromBlock ?? 0n,
    toBlock: "latest",
  });
  const event = events.at(-1);
  if (!event?.args.encryptedBundle || !event.args.bundleHash) throw new Error("No V4 encrypted bundle event was found for this case.");
  const actualHash = viemSha256(event.args.encryptedBundle);
  if (actualHash !== event.args.bundleHash) throw new Error("The published bundle bytes do not match their on-chain SHA-256.");
  const bundle = await parseV4BundleBytes(hexToBytes(event.args.encryptedBundle));
  if (bundle.caseId !== options.caseId || await hashText(bundle.caseId) !== caseIdHash) throw new Error("The recovered bundle is bound to a different case.");
  return { bundle, bundleHash: actualHash, transactionHash: event.transactionHash };
}
