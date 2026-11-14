import {
  envelopeFromText,
  envelopeToText,
  generateSealKeys,
  open,
  recipientOf,
  seal,
  sealKeysFromSeed,
  type SealKeyPair,
} from "@qorechain/qoreseal";
import { sealToAddresses } from "@qorechain/qoreseal/network";

import type {
  ConfidentialReport,
  OpenResult,
  Patch3QBundle,
  Patch3QKeyVault,
  PrivacyProfile,
  PublicMetadata,
  ReportAttachment,
  ReportDraft,
  ReporterMode,
  SealResult,
} from "../types.js";
import { createDemoApprovalAuthority, resolveApprovalAuthority } from "./approval.js";
import { equalBytes, fromBase64Url, fromUtf8, randomBytes, sha256, toBase64Url, utf8 } from "./encoding.js";
import { padToBucket, payoutCommitment, pqKeyHash, sealedPayout } from "./privacy.js";
import { MAX_ATTACHMENT_BYTES, PATCH3Q_CHAIN_ID, PATCH3Q_PURPOSE, PATCH3Q_REST_PROXY } from "./protocol.js";

export { MAX_ATTACHMENT_BYTES, PATCH3Q_CHAIN_ID, PATCH3Q_PURPOSE, PATCH3Q_REST_PROXY } from "./protocol.js";

type AuthenticatedFields =
  "caseId" | "chainId" | "purpose" | "createdAt" | "mode" | "sealMode" | "anonymous" | "recipients" |
  "publicMetadata" | "privacy" | "approvalAuthorities";

interface AuthenticatedMetadata extends Pick<Patch3QBundle, AuthenticatedFields> {
  type: "patch3q.aad";
  version: 5;
}

export interface SealReportOptions {
  report: ReportDraft;
  attachment?: ReportAttachment;
  mode: "demo" | "testnet";
  /** "anonymous" anchors through a relayer with a per-case reporter key and a sealed payout address. */
  reporterMode?: ReporterMode;
  payoutAddress?: string;
  reporterAddress?: string;
  maintainerAddress?: string;
  auditorAddress?: string;
  now?: Date;
  /** Testnet rehearsals only: shorter public deadlines than the default 24-hour / 7-day SLA. */
  deadlines?: { acknowledgeBy: Date; triageBy: Date; embargoUntil: Date };
  /** REST base for key-registry reads; the browser uses the same-origin proxy. */
  rest?: string;
}

function addHours(date: Date, hours: number): string {
  return new Date(date.getTime() + hours * 60 * 60 * 1000).toISOString();
}

function buildAuthenticatedMetadata(bundle: Pick<Patch3QBundle, AuthenticatedFields>): AuthenticatedMetadata {
  return {
    type: "patch3q.aad",
    version: 5,
    caseId: bundle.caseId,
    chainId: bundle.chainId,
    purpose: bundle.purpose,
    createdAt: bundle.createdAt,
    mode: bundle.mode,
    sealMode: bundle.sealMode,
    anonymous: bundle.anonymous,
    recipients: bundle.recipients,
    publicMetadata: bundle.publicMetadata,
    privacy: bundle.privacy,
    approvalAuthorities: bundle.approvalAuthorities,
  };
}

function authenticatedMetadataBytes(bundle: Pick<Patch3QBundle, AuthenticatedFields>): Uint8Array {
  return utf8(JSON.stringify(buildAuthenticatedMetadata(bundle)));
}

async function keyFingerprint(keys: SealKeyPair): Promise<string> {
  return sha256(keys.mlkemPublicKey);
}

function makeVault(caseId: string, role: Patch3QKeyVault["role"], label: string, keys: SealKeyPair): Patch3QKeyVault {
  return {
    type: "patch3q.demo-key",
    version: 1,
    caseId,
    role,
    label,
    seed: toBase64Url(keys.seed),
    warning: "DEMO SECRET — anyone holding this vault can decrypt this case. Never publish it.",
  };
}

export async function sealReport(options: SealReportOptions): Promise<SealResult> {
  if (options.attachment && options.attachment.size > MAX_ATTACHMENT_BYTES) {
    throw new Error("Attachment exceeds the 512 KiB Patch3Q demo limit.");
  }

  const now = options.now ?? new Date();
  const createdAt = now.toISOString();
  const rest = options.rest ?? PATCH3Q_REST_PROXY;
  const reporterMode = options.reporterMode ?? "account";
  const acknowledgeBy = options.deadlines?.acknowledgeBy.toISOString() ?? addHours(now, 24);
  const triageBy = options.deadlines?.triageBy.toISOString() ?? addHours(now, 24 * 7);
  const embargoUntil = options.deadlines?.embargoUntil ?? new Date(options.report.embargoUntil);
  if (Number.isNaN(embargoUntil.getTime()) || embargoUntil.getTime() < Date.parse(triageBy)) {
    throw new Error("The disclosure embargo must end after the seven-day triage deadline.");
  }
  if (!(Date.parse(acknowledgeBy) > now.getTime() && Date.parse(triageBy) > Date.parse(acknowledgeBy))) {
    throw new Error("Deadlines must be in the future and triage must follow acknowledgement.");
  }
  const caseId = "P3Q-" + toBase64Url(randomBytes(12)).toUpperCase();
  const payout = reporterMode === "anonymous" ? sealedPayout(options.payoutAddress ?? "") : undefined;
  let approvalAuthorities: Patch3QBundle["approvalAuthorities"];
  let approvalVaults: SealResult["approvalVaults"];
  if (options.mode === "testnet" && reporterMode === "anonymous") {
    if (!options.maintainerAddress?.trim() || !options.auditorAddress?.trim()) {
      throw new Error("Enter both program and auditor QoreChain testnet addresses.");
    }
    const [reporterKey, program, auditor] = await Promise.all([
      createDemoApprovalAuthority(caseId, "reporter", "per-case"),
      resolveApprovalAuthority(options.maintainerAddress, "program", rest),
      resolveApprovalAuthority(options.auditorAddress, "auditor", rest),
    ]);
    if (program.evmAddress.toLowerCase() === auditor.evmAddress.toLowerCase()) {
      throw new Error("Program and auditor must be two distinct QoreChain accounts.");
    }
    approvalAuthorities = { reporter: reporterKey.authority, program, auditor };
    approvalVaults = [reporterKey.vault];
  } else if (options.mode === "demo") {
    const [reporterApproval, programApproval, auditorApproval] = await Promise.all([
      createDemoApprovalAuthority(caseId, "reporter", reporterMode === "anonymous" ? "per-case" : "embedded-demo"),
      createDemoApprovalAuthority(caseId, "program"),
      createDemoApprovalAuthority(caseId, "auditor"),
    ]);
    approvalAuthorities = {
      reporter: reporterApproval.authority,
      program: programApproval.authority,
      auditor: auditorApproval.authority,
    };
    approvalVaults = [reporterApproval.vault, programApproval.vault, auditorApproval.vault];
  } else {
    if (!options.reporterAddress?.trim() || !options.maintainerAddress?.trim() || !options.auditorAddress?.trim()) {
      throw new Error("Connect the reporter wallet and enter both program and auditor QoreChain testnet addresses.");
    }
    const [reporter, program, auditor] = await Promise.all([
      resolveApprovalAuthority(options.reporterAddress, "reporter", rest),
      resolveApprovalAuthority(options.maintainerAddress, "program", rest),
      resolveApprovalAuthority(options.auditorAddress, "auditor", rest),
    ]);
    if (new Set([reporter.evmAddress, program.evmAddress, auditor.evmAddress].map((value) => value.toLowerCase())).size !== 3) {
      throw new Error("Reporter, program, and auditor must be three distinct QoreChain accounts.");
    }
    approvalAuthorities = { reporter, program, auditor };
  }
  const publicMetadata: PublicMetadata = {
    acknowledgeBy,
    triageBy,
    embargoUntil: embargoUntil.toISOString(),
  };
  let vaults: Patch3QKeyVault[] = [];
  let recipients: Patch3QBundle["recipients"];
  let demoKeys: { maintainer: SealKeyPair; auditor: SealKeyPair } | undefined;
  let testnetAddresses: Array<{ role: "maintainer" | "auditor"; label: string; address: string }> | undefined;
  if (options.mode === "demo") {
    const maintainer = generateSealKeys();
    const auditor = generateSealKeys();
    demoKeys = { maintainer, auditor };
    vaults = [
      makeVault(caseId, "maintainer", "Program security team", maintainer),
      makeVault(caseId, "auditor", "Independent disclosure auditor", auditor),
    ];
    recipients = [
      { role: "maintainer", label: "Program security team", keyFingerprint: await keyFingerprint(maintainer) },
      { role: "auditor", label: "Independent disclosure auditor", keyFingerprint: await keyFingerprint(auditor) },
    ];
  } else {
    testnetAddresses = [
      { role: "maintainer" as const, label: "Program security team", address: options.maintainerAddress?.trim() ?? "" },
      { role: "auditor" as const, label: "Independent disclosure auditor", address: options.auditorAddress?.trim() ?? "" },
    ];
    if (testnetAddresses.some(({ address }) => !address)) {
      throw new Error("Enter both maintainer and auditor QoreChain testnet addresses.");
    }
    recipients = testnetAddresses;
  }
  const sealMode = options.mode === "demo" ? "hybrid" as const : "mlkem" as const;
  const unpadded: ConfidentialReport = {
    type: "patch3q.report",
    version: 1,
    caseId,
    createdAt,
    salt: toBase64Url(randomBytes(32)),
    report: options.report,
    ...(options.attachment ? { attachment: options.attachment } : {}),
    ...(payout ? { payout } : {}),
  };
  const { json, bucket } = padToBucket(unpadded);
  const caseIdHash = await sha256(utf8(caseId));
  const reporterPqPublicKey = approvalAuthorities?.reporter.pqPublicKey;
  const privacy: PrivacyProfile = reporterMode === "anonymous" && payout && reporterPqPublicKey
    ? {
        reporterMode,
        reporterPqKeyHash: pqKeyHash(fromBase64Url(reporterPqPublicKey)),
        payoutCommitment: payoutCommitment(caseIdHash, payout),
        sizeBucket: bucket,
      }
    : { reporterMode: "account", sizeBucket: bucket };
  const metadataBase = {
    caseId,
    chainId: PATCH3Q_CHAIN_ID,
    purpose: PATCH3Q_PURPOSE,
    createdAt,
    mode: options.mode,
    sealMode,
    anonymous: true,
    recipients,
    publicMetadata,
    privacy,
    approvalAuthorities,
  } as const;
  const aadBytes = authenticatedMetadataBytes(metadataBase);
  const plaintext = utf8(json);
  const contentCommitment = await sha256(plaintext);

  let envelope: Uint8Array;
  if (options.mode === "demo") {
    if (!demoKeys) throw new Error("Demo recipient keys were not initialized.");
    envelope = seal({
      chainId: PATCH3Q_CHAIN_ID,
      purpose: PATCH3Q_PURPOSE,
      recipients: [recipientOf(demoKeys.maintainer), recipientOf(demoKeys.auditor)],
      plaintext,
      aad: aadBytes,
      mode: "hybrid",
      anonymous: true,
    });
  } else {
    if (!testnetAddresses) throw new Error("Testnet recipients were not initialized.");
    envelope = await sealToAddresses({
      rest,
      chainId: PATCH3Q_CHAIN_ID,
      purpose: PATCH3Q_PURPOSE,
      recipients: testnetAddresses.map(({ address }) => ({ address })),
      plaintext,
      aad: aadBytes,
      mode: "mlkem",
      anonymous: true,
    });
  }

  const bundle: Patch3QBundle = {
    type: "patch3q.bundle",
    version: 5,
    ...metadataBase,
    aad: toBase64Url(aadBytes),
    envelope: envelopeToText(envelope),
    envelopeHash: await sha256(envelope),
    contentCommitment,
  };
  return { bundle, vaults, approvalVaults, payout };
}

export function parseBundle(value: string): Patch3QBundle {
  const parsed: unknown = JSON.parse(value);
  if (!parsed || typeof parsed !== "object") throw new Error("Bundle must be a JSON object.");
  const candidate = parsed as Partial<Patch3QBundle>;
  if (candidate.type !== "patch3q.bundle" || candidate.version !== 5) throw new Error("Unsupported Patch3Q bundle.");
  if (
    !candidate.caseId || !candidate.envelope || !candidate.aad || !candidate.envelopeHash ||
    !candidate.contentCommitment || !candidate.privacy
  ) {
    throw new Error("Patch3Q bundle is missing required fields.");
  }
  if (candidate.chainId !== PATCH3Q_CHAIN_ID || candidate.purpose !== PATCH3Q_PURPOSE) {
    throw new Error("Bundle uses an unsupported chain or purpose.");
  }
  return candidate as Patch3QBundle;
}

export function parseVault(value: string): Patch3QKeyVault {
  const parsed: unknown = JSON.parse(value);
  if (!parsed || typeof parsed !== "object") throw new Error("Recipient vault must be a JSON object.");
  const candidate = parsed as Partial<Patch3QKeyVault>;
  if (candidate.type !== "patch3q.demo-key" || candidate.version !== 1 || !candidate.seed || !candidate.caseId) {
    throw new Error("Unsupported or incomplete Patch3Q recipient vault.");
  }
  return candidate as Patch3QKeyVault;
}

export async function openBundle(bundle: Patch3QBundle, vault: Patch3QKeyVault): Promise<OpenResult> {
  if (bundle.caseId !== vault.caseId) throw new Error("This recipient vault belongs to a different Patch3Q case.");
  const seed = fromBase64Url(vault.seed);
  if (seed.length !== 32) throw new Error("Recipient vault seed must be 32 bytes.");
  const envelope = envelopeFromText(bundle.envelope);
  const suppliedAad = fromBase64Url(bundle.aad);
  const expectedAad = authenticatedMetadataBytes(bundle);
  const plaintext = open({
    chainId: bundle.chainId,
    purpose: bundle.purpose,
    envelope,
    keys: sealKeysFromSeed(seed),
    aad: suppliedAad,
  });
  const payload = JSON.parse(fromUtf8(plaintext)) as ConfidentialReport;
  if (payload.type !== "patch3q.report" || payload.version !== 1) throw new Error("Decrypted payload is not a Patch3Q report.");
  let attachmentHash = true;
  if (payload.attachment) {
    const attachmentBytes = fromBase64Url(payload.attachment.data);
    attachmentHash =
      attachmentBytes.byteLength === payload.attachment.size &&
      (await sha256(attachmentBytes)) === payload.attachment.sha256;
  }
  const privacy = bundle.privacy;
  const reporterKey = bundle.approvalAuthorities?.reporter.pqPublicKey;
  const payoutBinding = privacy.reporterMode === "anonymous"
    ? Boolean(
        payload.payout && privacy.payoutCommitment && reporterKey &&
        payoutCommitment(await sha256(utf8(bundle.caseId)), payload.payout) === privacy.payoutCommitment &&
        pqKeyHash(fromBase64Url(reporterKey)) === privacy.reporterPqKeyHash,
      )
    : !payload.payout;
  const checks = {
    envelopeHash: (await sha256(envelope)) === bundle.envelopeHash,
    contentCommitment: (await sha256(plaintext)) === bundle.contentCommitment,
    attachmentHash,
    authenticatedMetadata: equalBytes(suppliedAad, expectedAad),
    caseBinding: payload.caseId === bundle.caseId && payload.createdAt === bundle.createdAt,
    payoutBinding,
    sizeBucket: plaintext.length === privacy.sizeBucket,
  };
  return { payload, checks, verified: Object.values(checks).every(Boolean) };
}

export async function hashText(value: string): Promise<`0x${string}`> {
  return sha256(utf8(value));
}

export function bundleToJson(bundle: Patch3QBundle): string {
  return JSON.stringify(bundle, null, 2);
}

export function vaultToJson(vault: Patch3QKeyVault): string {
  return JSON.stringify(vault, null, 2);
}
