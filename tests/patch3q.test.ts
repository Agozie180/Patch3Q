import { envelopeFromText, envelopeToText } from "@qorechain/qoreseal";
import { beforeAll, describe, expect, it } from "vitest";

import { fromBase64Url, toBase64Url } from "../src/lib/encoding.js";
import {
  createSeverityApproval,
  demonstrateClassicalOnlyForgeryRejection,
  verifySeverityApproval,
} from "../src/lib/approval.js";
import {
  bundleToJson,
  openBundle,
  parseBundle,
  parseVault,
  sealReport,
  vaultToJson,
} from "../src/lib/patch3q.js";
import type { Patch3QApprovalVault, Patch3QBundle, ReportDraft, SealResult } from "../src/types.js";

const report: ReportDraft = {
  title: "Threshold signature accepts a duplicate signer",
  program: "Patch3Q test program",
  asset: "contracts/Verifier.sol",
  severity: "critical",
  reporterAlias: "researcher-zero",
  summary: "The verifier counts the same signer twice.",
  impact: "An attacker can satisfy quorum without the required independent signers.",
  reproduction: "1. Duplicate one signature.\n2. Submit the proof.\n3. Observe successful verification.",
  remediation: "Reject duplicate signer identifiers before accumulating signature weight.",
  embargoUntil: "2030-01-01",
};
const registryAddress = "0x1111111111111111111111111111111111111111" as const;

describe("Patch3Q disclosure bundles", () => {
  let sealed: SealResult;
  let unrelated: SealResult;

  beforeAll(async () => {
    sealed = await sealReport({ report, mode: "demo", now: new Date("2026-11-13T10:00:00Z") });
    unrelated = await sealReport({ report, mode: "demo", now: new Date("2026-11-13T11:00:00Z") });
  }, 60_000);

  function approvalVaults(participantRole: "reporter" | "program" = "program"): {
    participant: Patch3QApprovalVault;
    auditor: Patch3QApprovalVault;
  } {
    const participant = sealed.approvalVaults?.find((vault) => vault.role === participantRole);
    const auditor = sealed.approvalVaults?.find((vault) => vault.role === "auditor");
    if (!participant || !auditor) throw new Error("Demo seal did not return the required approval vaults.");
    return { participant, auditor };
  }

  it("opens independently for maintainer and auditor", async () => {
    const maintainer = await openBundle(sealed.bundle, sealed.vaults[0]);
    const auditor = await openBundle(sealed.bundle, sealed.vaults[1]);
    expect(maintainer.verified).toBe(true);
    expect(auditor.verified).toBe(true);
    expect(auditor.payload.report.title).toBe(report.title);
  });

  it("rejects an embargo that ends before the triage deadline", async () => {
    await expect(sealReport({
      report: { ...report, embargoUntil: "2026-11-15" },
      mode: "demo",
      now: new Date("2026-11-13T10:00:00Z"),
    })).rejects.toThrow("seven-day triage deadline");
  });

  it("exports only ciphertext and public metadata, never report or PoC plaintext", () => {
    const leakedStorage = bundleToJson(sealed.bundle);
    expect(leakedStorage).not.toContain(report.title);
    expect(leakedStorage).not.toContain(report.summary);
    expect(leakedStorage).not.toContain(report.reproduction);
    expect(leakedStorage).not.toContain(report.remediation);
    expect(leakedStorage).not.toContain(report.reporterAlias);
  });

  it("rejects a key that is not a recipient", async () => {
    const wrongVault = { ...unrelated.vaults[0], caseId: sealed.bundle.caseId };
    await expect(openBundle(sealed.bundle, wrongVault)).rejects.toThrow();
  });

  it("rejects a one-byte ciphertext mutation", async () => {
    const envelope = envelopeFromText(sealed.bundle.envelope);
    envelope[envelope.length - 1] ^= 1;
    const tampered = { ...sealed.bundle, envelope: envelopeToText(envelope) };
    await expect(openBundle(tampered, sealed.vaults[0])).rejects.toThrow();
  });

  it("does not accept an attachment whose declared hash is false", async () => {
    const data = new TextEncoder().encode("synthetic proof of concept");
    const withDishonestAttachment = await sealReport({
      report,
      mode: "demo",
      attachment: {
        name: "poc.txt",
        mediaType: "text/plain",
        size: data.byteLength,
        sha256: ("0x" + "00".repeat(32)) as `0x${string}`,
        data: toBase64Url(data),
      },
    });
    const result = await openBundle(withDishonestAttachment.bundle, withDishonestAttachment.vaults[0]);
    expect(result.verified).toBe(false);
    expect(result.checks.contentCommitment).toBe(true);
    expect(result.checks.attachmentHash).toBe(false);
  });

  it("rejects the wrong cryptographic purpose", async () => {
    const wrongPurpose = {
      ...sealed.bundle,
      purpose: "patch3q:wrong-context:v1",
    } as unknown as Patch3QBundle;
    await expect(openBundle(wrongPurpose, sealed.vaults[0])).rejects.toThrow();
  });

  it("rejects altered authenticated data", async () => {
    const aad = fromBase64Url(sealed.bundle.aad);
    aad[0] ^= 1;
    const tampered = { ...sealed.bundle, aad: toBase64Url(aad) };
    await expect(openBundle(tampered, sealed.vaults[0])).rejects.toThrow();
  });

  it("survives JSON export and import with every integrity check", async () => {
    const bundle = parseBundle(bundleToJson(sealed.bundle));
    const vault = parseVault(vaultToJson(sealed.vaults[1]));
    const result = await openBundle(bundle, vault);
    expect(result.verified).toBe(true);
    expect(Object.values(result.checks)).toEqual([true, true, true, true, true]);
    expect(bundle.version).toBe(4);
    expect(bundle.approvalAuthorities?.reporter.role).toBe("reporter");
    expect(bundle.approvalAuthorities?.program.role).toBe("program");
    expect(bundle.approvalAuthorities?.auditor.role).toBe("auditor");
  });

  it("detects changed public deadlines even when ciphertext still decrypts", async () => {
    const changed = {
      ...sealed.bundle,
      publicMetadata: {
        ...sealed.bundle.publicMetadata,
        triageBy: "2031-01-01T00:00:00.000Z",
      },
    };
    const result = await openBundle(changed, sealed.vaults[0]);
    expect(result.verified).toBe(false);
    expect(result.checks.authenticatedMetadata).toBe(false);
  });

  it("detects altered public recipient metadata", async () => {
    const changed = {
      ...sealed.bundle,
      recipients: sealed.bundle.recipients.map((recipient, index) =>
        index === 0 ? { ...recipient, label: "Attacker-controlled mailbox" } : recipient),
    };
    const result = await openBundle(changed, sealed.vaults[0]);
    expect(result.verified).toBe(false);
    expect(result.checks.authenticatedMetadata).toBe(false);
  });

  it("detects an altered reporter authority in the sealed metadata", async () => {
    const changed = {
      ...sealed.bundle,
      approvalAuthorities: {
        ...sealed.bundle.approvalAuthorities!,
        reporter: {
          ...sealed.bundle.approvalAuthorities!.reporter,
          evmAddress: "0x2222222222222222222222222222222222222222" as const,
        },
      },
    };
    const result = await openBundle(changed, sealed.vaults[0]);
    expect(result.verified).toBe(false);
    expect(result.checks.authenticatedMetadata).toBe(false);
  });

  it("detects a forged envelope hash", async () => {
    const changed = {
      ...sealed.bundle,
      envelopeHash: ("0x" + "00".repeat(32)) as `0x${string}`,
    };
    const result = await openBundle(changed, sealed.vaults[0]);
    expect(result.verified).toBe(false);
    expect(result.checks.envelopeHash).toBe(false);
  });

  it("issues and verifies two independent ML-DSA-87 hybrid severity approvals", async () => {
    const approval = await createSeverityApproval({
      bundle: sealed.bundle,
      participantRole: "program",
      vaults: approvalVaults(),
      registryAddress,
      severity: "critical",
      payoutAtomic: "2500000000",
      rationale: "The duplicate signer bypass permits unauthorized quorum and direct loss.",
      now: new Date("2026-11-14T08:00:00Z"),
    });
    const result = await verifySeverityApproval(sealed.bundle, approval);
    expect(result.verified).toBe(true);
    expect(approval.signatures.participant.signatureType).toBe("ml-dsa-87-hybrid");
    expect(approval.signatures.auditor.signatureType).toBe("ml-dsa-87-hybrid");
  });

  it("issues reporter and auditor approval for an escalated case", async () => {
    const approval = await createSeverityApproval({
      bundle: sealed.bundle,
      participantRole: "reporter",
      vaults: approvalVaults("reporter"),
      registryAddress,
      severity: "critical",
      payoutAtomic: "2500000000",
      rationale: "The program missed its deadline, so the reporter and auditor authorize the escrow consequence.",
    });
    const result = await verifySeverityApproval(sealed.bundle, approval, registryAddress, "reporter");
    expect(result.verified).toBe(true);
    expect(approval.participantRole).toBe("reporter");
    expect(approval.signers.participant).toBe(sealed.bundle.approvalAuthorities?.reporter.signer);
  });

  it("rejects a program approval when the on-chain case expects the reporter", async () => {
    const approval = await createSeverityApproval({
      bundle: sealed.bundle,
      participantRole: "program",
      vaults: approvalVaults(),
      registryAddress,
      severity: "critical",
      payoutAtomic: "2500000000",
      rationale: "This otherwise valid approval uses the wrong participant for an escalated case.",
    });
    const result = await verifySeverityApproval(sealed.bundle, approval, registryAddress, "reporter");
    expect(result.verified).toBe(false);
    expect(result.checks.participantRoleBinding).toBe(false);
  });

  it("rejects a severity approval changed after signing", async () => {
    const approval = await createSeverityApproval({
      bundle: sealed.bundle,
      participantRole: "program",
      vaults: approvalVaults(),
      registryAddress,
      severity: "high",
      payoutAtomic: "500000000",
      rationale: "The bug crosses the intended authorization boundary and needs urgent repair.",
    });
    const tampered = {
      ...approval,
      statement: {
        ...approval.statement,
        payout: { ...approval.statement.payout, atomic: "9000000000" },
      },
    };
    const result = await verifySeverityApproval(sealed.bundle, tampered);
    expect(result.verified).toBe(false);
    expect(result.checks.participantHybridSignature).toBe(false);
    expect(result.checks.auditorHybridSignature).toBe(false);
    expect(result.checks.approvalHash).toBe(false);
  });

  it.each(["participant", "auditor"] as const)("rejects an altered %s PQ signature", async (role) => {
    const approval = await createSeverityApproval({
      bundle: sealed.bundle,
      participantRole: "program",
      vaults: approvalVaults(),
      registryAddress,
      severity: "high",
      payoutAtomic: "500000000",
      rationale: "The bug crosses the intended authorization boundary and needs urgent repair.",
    });
    const pq = approval.signatures[role].pq;
    if (!pq) throw new Error("Expected a PQ signature.");
    const tampered = {
      ...approval,
      signatures: {
        ...approval.signatures,
        [role]: {
          ...approval.signatures[role],
          pq: { ...pq, signature: (pq.signature[0] === "A" ? "B" : "A") + pq.signature.slice(1) },
        },
      },
    };
    const result = await verifySeverityApproval(sealed.bundle, tampered);
    expect(result.verified).toBe(false);
    expect(result.checks[role === "participant" ? "participantHybridSignature" : "auditorHybridSignature"]).toBe(false);
  });

  it("does not verify an approval for a different registry", async () => {
    const approval = await createSeverityApproval({
      bundle: sealed.bundle,
      participantRole: "program",
      vaults: approvalVaults(),
      registryAddress,
      severity: "high",
      payoutAtomic: "500000000",
      rationale: "The impact crosses an authorization boundary and requires prompt remediation.",
    });
    const otherRegistry = "0x2222222222222222222222222222222222222222" as const;
    const result = await verifySeverityApproval(sealed.bundle, approval, otherRegistry);
    expect(result.verified).toBe(false);
    expect(result.checks.registryBinding).toBe(false);
  });

  it.each(["program", "auditor"] as const)("does not verify an approval when the bound %s PQ-key fingerprint is altered", async (role) => {
    const approval = await createSeverityApproval({
      bundle: sealed.bundle,
      participantRole: "program",
      vaults: approvalVaults(),
      registryAddress,
      severity: "high",
      payoutAtomic: "500000000",
      rationale: "The impact crosses an authorization boundary and requires prompt remediation.",
    });
    const changedBundle = {
      ...sealed.bundle,
      approvalAuthorities: {
        ...sealed.bundle.approvalAuthorities!,
        [role]: {
          ...sealed.bundle.approvalAuthorities![role],
          keyFingerprint: "0x" + "00".repeat(32),
        },
      },
    };
    const result = await verifySeverityApproval(changedBundle, approval, registryAddress);
    expect(result.verified).toBe(false);
    expect(result.checks[role === "program" ? "participantKeyBinding" : "auditorKeyBinding"]).toBe(false);
  });

  it("demonstrates that neither classical key alone can forge approval", async () => {
    const approval = await createSeverityApproval({
      bundle: sealed.bundle,
      participantRole: "program",
      vaults: approvalVaults(),
      registryAddress,
      severity: "critical",
      payoutAtomic: "2500000000",
      rationale: "This approval is bound to both the encrypted evidence and the auditor keys.",
    });
    const vaults = approvalVaults();
    await expect(demonstrateClassicalOnlyForgeryRejection(sealed.bundle, approval, vaults.participant)).resolves.toBe(true);
    await expect(demonstrateClassicalOnlyForgeryRejection(sealed.bundle, approval, vaults.auditor)).resolves.toBe(true);
  });
});
