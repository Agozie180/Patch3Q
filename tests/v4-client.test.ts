import { describe, expect, it } from "vitest";

import { openBundle, sealReport } from "../src/lib/patch3q.js";
import { parseV4BundleBytes, v4BundleBytes } from "../src/lib/v4-bundle.js";
import {
  bundleAuditorThreshold,
  bundleAuditors,
  createV4QuorumApproval,
  v4AuditorSetHash,
  v4BundleHash,
  v4CaseStatus,
  v4ParticipantRole,
  verifyV4QuorumApproval,
} from "../src/lib/v4-approval.js";
import type { Patch3QApprovalVault, ReportDraft } from "../src/types.js";

const registry = "0x1111111111111111111111111111111111111111" as const;
const payoutAddress = "0x9a6d2c1b4E8F3a7D5c0B1e2F3A4b5C6d7E8f9A0B";
const report: ReportDraft = {
  title: "Duplicate signer accepted",
  program: "V4 test program",
  asset: "Verifier.sol",
  severity: "critical",
  reporterAlias: "researcher-zero",
  summary: "A duplicate signer satisfies quorum.",
  impact: "Unauthorized quorum can release protected assets.",
  reproduction: "Submit the same signer twice and observe threshold acceptance.",
  remediation: "Reject duplicate signer identities before counting weight.",
  embargoUntil: "2030-01-01",
};

async function fixture() {
  const sealed = await sealReport({
    report,
    mode: "demo",
    reporterMode: "anonymous",
    payoutAddress,
    demoAuditorCount: 3,
    auditorThreshold: 2,
    now: new Date("2026-11-20T10:00:00Z"),
  });
  const program = sealed.approvalVaults?.find((entry) => entry.role === "program");
  const reporter = sealed.approvalVaults?.find((entry) => entry.role === "reporter");
  const auditors = sealed.approvalVaults?.filter((entry) => entry.role === "auditor") ?? [];
  const opened = await openBundle(sealed.bundle, sealed.vaults[0]);
  if (!program || !reporter || auditors.length !== 3 || !opened.payload.payout) throw new Error("Invalid V4 fixture.");
  return { sealed, program, reporter, auditors, payout: opened.payload.payout };
}

describe("Patch3Q V4 client quorum", () => {
  it("uses V4's actual Escalated status 5 for reporter authority", () => {
    expect(v4ParticipantRole(5, "program")).toBe("reporter");
    expect(v4CaseStatus(5)).toBe("Escalated");
    expect(v4CaseStatus(6)).toBe("Status 6");
    expect(v4ParticipantRole(2, "reporter")).toBe("program");
    expect(v4ParticipantRole(3, "reporter")).toBe("program");
    expect(v4ParticipantRole(undefined, "reporter")).toBe("reporter");
  });
  it("compresses bundles deterministically and recovers the exact bundle", async () => {
    const { sealed } = await fixture();
    const first = await v4BundleBytes(sealed.bundle);
    const second = await v4BundleBytes(sealed.bundle);

    expect(first).toEqual(second);
    expect(first[0]).toBe(0x1f);
    expect(first[1]).toBe(0x8b);
    expect(first[9]).toBe(10);
    expect(await parseV4BundleBytes(first)).toEqual(sealed.bundle);
  }, 60_000);

  it("seals one ciphertext to a program and three independent auditors", async () => {
    const { sealed } = await fixture();
    expect(sealed.bundle.recipients).toHaveLength(4);
    expect(bundleAuditors(sealed.bundle)).toHaveLength(3);
    expect(bundleAuditorThreshold(sealed.bundle)).toBe(2);
    expect(new Set(bundleAuditors(sealed.bundle).map((entry) => entry.evmAddress)).size).toBe(3);
  }, 60_000);

  it("creates and verifies a 2-of-3 evidence-bound quorum approval", async () => {
    const { sealed, program, auditors, payout } = await fixture();
    const approval = await createV4QuorumApproval({
      bundle: sealed.bundle,
      participantRole: "program",
      participant: program,
      auditors: auditors.slice(0, 2),
      registryAddress: registry,
      severity: "critical",
      payoutAtomic: "2500000000",
      rationale: "The authorization bypass has direct loss potential and requires a critical payout.",
      payout,
    });
    const result = await verifyV4QuorumApproval(sealed.bundle, approval, registry, "program");
    expect(result.verified).toBe(true);
    expect(approval.auditors).toHaveLength(2);
    expect(approval.statement.bundleHash).toBe(await v4BundleHash(sealed.bundle));
    expect(approval.statement.auditorSetHash).toBe(v4AuditorSetHash(sealed.bundle));
  }, 60_000);

  it("rejects a single auditor when the bundle requires two", async () => {
    const { sealed, program, auditors, payout } = await fixture();
    await expect(createV4QuorumApproval({
      bundle: sealed.bundle,
      participantRole: "program",
      participant: program,
      auditors: auditors.slice(0, 1),
      registryAddress: registry,
      severity: "high",
      payoutAtomic: "100",
      rationale: "This rationale is long enough but quorum is intentionally incomplete.",
      payout,
    })).rejects.toThrow("quorum");
  }, 60_000);

  it("rejects duplicate auditor keys instead of double-counting one signer", async () => {
    const { sealed, program, auditors, payout } = await fixture();
    await expect(createV4QuorumApproval({
      bundle: sealed.bundle,
      participantRole: "program",
      participant: program,
      auditors: [auditors[0], auditors[0]] as Patch3QApprovalVault[],
      registryAddress: registry,
      severity: "high",
      payoutAtomic: "100",
      rationale: "A duplicated authority must never satisfy the independent auditor threshold.",
      payout,
    })).rejects.toThrow("Duplicate auditor");
  }, 60_000);

  it("uses the reporter instead of the program after SLA escalation", async () => {
    const { sealed, reporter, auditors, payout } = await fixture();
    const approval = await createV4QuorumApproval({
      bundle: sealed.bundle,
      participantRole: "reporter",
      participant: reporter,
      auditors: auditors.slice(1),
      registryAddress: registry,
      severity: "critical",
      payoutAtomic: "2500000000",
      rationale: "The program missed its SLA, so the reporter and independent quorum authorize payout.",
      payout,
    });
    expect((await verifyV4QuorumApproval(sealed.bundle, approval, registry, "reporter")).verified).toBe(true);
    expect((await verifyV4QuorumApproval(sealed.bundle, approval, registry, "program")).verified).toBe(false);
  }, 60_000);
});
