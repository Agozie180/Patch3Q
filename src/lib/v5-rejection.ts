import { signMessage } from "@qorechain/qoresign";
import { encodeAbiParameters, hexToBytes, isAddress, keccak256, toBytes, zeroAddress } from "viem";
import type { ApprovalSignerKeys } from "./approval.js";
import type { Patch3QApprovalVault, Patch3QBundle, V4SeverityApproval } from "../types.js";
import { sha256, toBase64Url, utf8 } from "./encoding.js";
import { saltedRationaleHash } from "./privacy.js";
import { PATCH3Q_REST_PROXY } from "./protocol.js";
import { bundleAuditors, bundleAuditorThreshold, keysFrom, v4AuditorSetHash, v4BundleHash, verifyAuthority } from "./v4-approval.js";

const REJECTION_TYPEHASH = keccak256(toBytes(
  "Patch3QV5Rejection(uint256 chainId,address registry,bytes32 caseIdHash,bytes32 envelopeHash,bytes32 contentCommitment,bytes32 bundleHash,bytes32 auditorSetHash,uint256 reservedAmount,bytes32 rationaleHash)",
));

export type V5Rejection = {
  type: "patch3q.v5-rejection";
  version: 1;
  statement: {
    caseId: string;
    chainId: string;
    evmChainId: 9800;
    registryAddress: `0x${string}`;
    envelopeHash: `0x${string}`;
    contentCommitment: `0x${string}`;
    bundleHash: `0x${string}`;
    auditorSetHash: `0x${string}`;
    reservedAmount: string;
    rationale: string;
    rationaleSalt: `0x${string}`;
    rationaleHash: `0x${string}`;
  };
  auditors: V4SeverityApproval["auditors"];
  rejectionHash: `0x${string}`;
};

export async function v5RejectionDigest(bundle: Patch3QBundle, registry: `0x${string}`, reservedAmount: string, rationaleHash: `0x${string}`) {
  return keccak256(encodeAbiParameters(
    [
      { type: "bytes32" }, { type: "uint256" }, { type: "address" }, { type: "bytes32" },
      { type: "bytes32" }, { type: "bytes32" }, { type: "bytes32" }, { type: "bytes32" },
      { type: "uint256" }, { type: "bytes32" },
    ],
    [REJECTION_TYPEHASH, 9800n, registry, await sha256(utf8(bundle.caseId)), bundle.envelopeHash,
      bundle.contentCommitment, await v4BundleHash(bundle), v4AuditorSetHash(bundle), BigInt(reservedAmount), rationaleHash],
  ));
}

export async function createV5Rejection(options: {
  bundle: Patch3QBundle;
  registryAddress: `0x${string}`;
  reservedAmount: string;
  rationale: string;
  auditors: (Patch3QApprovalVault | ApprovalSignerKeys)[];
}): Promise<V5Rejection> {
  const { bundle } = options;
  if (bundle.privacy.reporterMode !== "anonymous") throw new Error("V5 rejection requires an anonymous case.");
  if (!isAddress(options.registryAddress) || options.registryAddress === zeroAddress) throw new Error("Configure a V5 registry address.");
  if (!/^\d+$/u.test(options.reservedAmount) || BigInt(options.reservedAmount) <= 0n) throw new Error("Enter the full positive case reserve.");
  const rationale = options.rationale.trim();
  if (rationale.length < 12) throw new Error("Explain why this report is rejected.");
  const keys = options.auditors.map(keysFrom);
  if (new Set(keys.map((key) => key.signer.bech32)).size !== keys.length) throw new Error("Duplicate auditor keys.");
  if (keys.length < bundleAuditorThreshold(bundle)) throw new Error("Auditor quorum is incomplete.");
  for (const key of keys) {
    const authority = bundleAuditors(bundle).find((entry) => entry.signer === key.signer.bech32);
    if (!authority || authority.evmAddress.toLowerCase() !== key.signer.hex.toLowerCase() ||
        authority.keyFingerprint !== await sha256(key.pqKey.publicKey)) throw new Error("Auditor key is not bound to this case.");
  }
  const rationaleSalt = keccak256(crypto.getRandomValues(new Uint8Array(32)));
  const rationaleHash = saltedRationaleHash(rationaleSalt, rationale);
  const rejectionHash = await v5RejectionDigest(bundle, options.registryAddress, options.reservedAmount, rationaleHash);
  return {
    type: "patch3q.v5-rejection", version: 1,
    statement: {
      caseId: bundle.caseId, chainId: bundle.chainId, evmChainId: 9800, registryAddress: options.registryAddress,
      envelopeHash: bundle.envelopeHash, contentCommitment: bundle.contentCommitment,
      bundleHash: await v4BundleHash(bundle), auditorSetHash: v4AuditorSetHash(bundle),
      reservedAmount: options.reservedAmount, rationale, rationaleSalt, rationaleHash,
    },
    auditors: keys.map((key) => ({
      signer: key.signer.bech32, evmAddress: key.signer.hex as `0x${string}`,
      signature: signMessage({ chainId: bundle.chainId, signer: key.signer.bech32,
        data: hexToBytes(rejectionHash), classicalKey: key.classicalKey, pqKey: key.pqKey }),
    })),
    rejectionHash,
  };
}

export async function verifyV5Rejection(bundle: Patch3QBundle, rejection: V5Rejection,
  expectedRegistry: `0x${string}`, expectedReserve: string, rest = PATCH3Q_REST_PROXY) {
  const statement = rejection.statement;
  const checks = {
    shape: rejection.type === "patch3q.v5-rejection" && rejection.version === 1 && bundle.privacy.reporterMode === "anonymous",
    caseBinding: statement.caseId === bundle.caseId && statement.chainId === bundle.chainId,
    registryBinding: statement.evmChainId === 9800 && isAddress(statement.registryAddress) && statement.registryAddress !== zeroAddress && statement.registryAddress.toLowerCase() === expectedRegistry.toLowerCase(),
    reserveBinding: /^\d+$/u.test(statement.reservedAmount) && BigInt(statement.reservedAmount) > 0n && statement.reservedAmount === expectedReserve,
    evidenceBinding: statement.envelopeHash === bundle.envelopeHash && statement.contentCommitment === bundle.contentCommitment && statement.bundleHash === await v4BundleHash(bundle) && statement.auditorSetHash === v4AuditorSetHash(bundle),
    rationaleBinding: /^0x[0-9a-f]{64}$/u.test(statement.rationaleSalt) && statement.rationale.trim().length >= 12 && saltedRationaleHash(statement.rationaleSalt, statement.rationale) === statement.rationaleHash,
    auditorUniqueness: new Set(rejection.auditors.map((entry) => entry.signer)).size === rejection.auditors.length,
    auditorQuorum: rejection.auditors.length >= bundleAuditorThreshold(bundle),
    auditorKeys: false,
    auditorSignatures: false,
    digestBinding: false,
  };
  if (checks.registryBinding && checks.reserveBinding) {
    const digest = await v5RejectionDigest(bundle, statement.registryAddress, statement.reservedAmount, statement.rationaleHash);
    checks.digestBinding = digest === rejection.rejectionHash;
    const authorities = bundleAuditors(bundle);
    const verified = await Promise.all(rejection.auditors.map(async (entry) => {
      const authority = authorities.find((candidate) => candidate.signer === entry.signer && candidate.evmAddress.toLowerCase() === entry.evmAddress.toLowerCase());
      return verifyAuthority(bundle, authority, entry.signer, entry.signature, digest, rest);
    }));
    checks.auditorKeys = verified.length > 0 && verified.every((entry) => entry.key);
    checks.auditorSignatures = verified.length > 0 && verified.every((entry) => entry.signature);
  }
  return { verified: Object.values(checks).every(Boolean), checks };
}
