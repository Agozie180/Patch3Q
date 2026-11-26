import { beforeAll, describe, expect, it } from "vitest";
import { sealReport } from "../src/lib/patch3q.js";
import { createV5Rejection, verifyV5Rejection, v5RejectionDigest } from "../src/lib/v5-rejection.js";
import type { V5Rejection } from "../src/lib/v5-rejection.js";
import type { Patch3QApprovalVault, SealResult } from "../src/types.js";

describe("V5 quorum rejection signatures", () => {
  const registry = "0x1111111111111111111111111111111111111111";
  const reserve = "2500000000";
  let sealed: SealResult;
  let auditors: Patch3QApprovalVault[];
  let verdict: V5Rejection;
  beforeAll(async () => {
    sealed = await sealReport({ mode: "demo", reporterMode: "anonymous", demoAuditorCount: 3, auditorThreshold: 2,
      payoutAddress: "0x2222222222222222222222222222222222222222",
      report: { title: "Synthetic invalid report", program: "Review program", asset: "Example.sol", severity: "low",
        reporterAlias: "anonymous", summary: "This report is a duplicate.", impact: "No additional impact.",
        reproduction: "Same finding as an earlier report.", remediation: "Already fixed.", embargoUntil: "2030-01-01" } });
    auditors = sealed.approvalVaults!.filter((entry) => entry.role === "auditor");
    verdict = await createV5Rejection({ bundle: sealed.bundle, registryAddress: registry, reservedAmount: reserve,
      rationale: "Independent auditors verified this is an invalid duplicate finding.", auditors: auditors.slice(0, 2) });
  }, 60_000);

  it("verifies two real hybrid PQ rejection signatures without a participant signature", async () => {
    expect((await verifyV5Rejection(sealed.bundle, verdict, registry, reserve)).verified).toBe(true);
    expect(verdict.rejectionHash).toBe(await v5RejectionDigest(sealed.bundle, registry, reserve, verdict.statement.rationaleHash));
  });
  it("rejects a sub-threshold verdict", async () => {
    const invalid = structuredClone(verdict); invalid.auditors.pop();
    expect((await verifyV5Rejection(sealed.bundle, invalid, registry, reserve)).verified).toBe(false);
  });
  it("rejects repeated auditors", async () => {
    const invalid = structuredClone(verdict); invalid.auditors[1] = invalid.auditors[0];
    expect((await verifyV5Rejection(sealed.bundle, invalid, registry, reserve)).verified).toBe(false);
  });
  it("rejects ECDSA-only signatures", async () => {
    const invalid = structuredClone(verdict); delete invalid.auditors[0].signature.pq;
    expect((await verifyV5Rejection(sealed.bundle, invalid, registry, reserve)).verified).toBe(false);
  });
  it("rejects a verdict replayed against another registry or reserve", async () => {
    expect((await verifyV5Rejection(sealed.bundle, verdict, "0x3333333333333333333333333333333333333333", reserve)).verified).toBe(false);
    expect((await verifyV5Rejection(sealed.bundle, verdict, registry, "1")).verified).toBe(false);
  });
  it("rejects altered case evidence and rationale", async () => {
    const invalid = structuredClone(verdict); invalid.statement.rationale += " modified";
    expect((await verifyV5Rejection(sealed.bundle, invalid, registry, reserve)).verified).toBe(false);
    const otherBundle = structuredClone(sealed.bundle); otherBundle.caseId += "-other";
    expect((await verifyV5Rejection(otherBundle, verdict, registry, reserve)).verified).toBe(false);
  });
  it("refuses to create a verdict with duplicate or insufficient auditor keys", async () => {
    const options = { bundle: sealed.bundle, registryAddress: registry, reservedAmount: reserve, rationale: "Invalid duplicate report independently checked." };
    await expect(createV5Rejection({ ...options, auditors: [auditors[0]] })).rejects.toThrow("quorum");
    await expect(createV5Rejection({ ...options, auditors: [auditors[0], auditors[0]] })).rejects.toThrow("Duplicate");
  });
  it("refuses a verdict from a participant acting as an auditor", async () => {
    const program = sealed.approvalVaults!.find((entry) => entry.role === "program")!;
    await expect(createV5Rejection({ bundle: sealed.bundle, registryAddress: registry, reservedAmount: reserve,
      rationale: "The program must not reject alone by pretending to be an auditor.", auditors: [auditors[0], program] })).rejects.toThrow("not bound");
  });
});
