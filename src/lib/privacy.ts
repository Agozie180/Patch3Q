import { concatHex, encodeAbiParameters, getAddress, isAddress, keccak256, toBytes, toHex, zeroAddress } from "viem";

import type { SealedPayout } from "../types.js";
import { bytesToHex, randomBytes } from "./encoding.js";

/** Plaintext sizes every report is padded up to. The largest fits the 512 KiB PoC limit after base64url. */
export const SIZE_BUCKETS = [16 * 1024, 64 * 1024, 256 * 1024, 1024 * 1024] as const;

const PAYOUT_COMMITMENT_TYPEHASH = keccak256(toBytes(
  "Patch3QPayoutCommitment(bytes32 caseIdHash,address payoutRecipient,bytes32 salt)",
));

export function sizeBucketFor(length: number): number {
  const bucket = SIZE_BUCKETS.find((size) => size >= length);
  if (!bucket) throw new Error("The report is larger than the biggest Patch3Q size bucket.");
  return bucket;
}

/**
 * Serialises `payload` with a `padding` field sized so the UTF-8 result is exactly one bucket long.
 * The filler is ASCII, so its JSON length equals its byte length.
 */
export function padToBucket<T extends object>(payload: T): { json: string; bucket: number } {
  const base = new TextEncoder().encode(JSON.stringify({ ...payload, padding: "" })).length;
  const bucket = sizeBucketFor(base);
  const json = JSON.stringify({ ...payload, padding: "0".repeat(bucket - base) });
  return { json, bucket };
}

export function payoutCommitment(caseIdHash: `0x${string}`, payout: SealedPayout): `0x${string}` {
  return keccak256(encodeAbiParameters(
    [{ type: "bytes32" }, { type: "bytes32" }, { type: "address" }, { type: "bytes32" }],
    [PAYOUT_COMMITMENT_TYPEHASH, caseIdHash, payout.recipient, payout.salt],
  ));
}

export function sealedPayout(recipient: string): SealedPayout {
  const trimmed = recipient.trim();
  if (!isAddress(trimmed, { strict: false }) || trimmed.toLowerCase() === zeroAddress) {
    throw new Error("Enter a fresh 0x payout address that has never been linked to your identity.");
  }
  return { recipient: getAddress(trimmed.toLowerCase()), salt: bytesToHex(randomBytes(32)) };
}

/** keccak256 of the raw ML-DSA-87 public key, matching the registry's snapshot of registered keys. */
export function pqKeyHash(publicKey: Uint8Array): `0x${string}` {
  return keccak256(toHex(publicKey));
}

export function saltedRationaleHash(salt: `0x${string}`, rationale: string): `0x${string}` {
  return keccak256(concatHex([salt, toHex(toBytes(rationale))]));
}
