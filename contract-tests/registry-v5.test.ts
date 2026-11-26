import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import { network } from "hardhat";
import { encodeAbiParameters, keccak256, sha256, toBytes, toHex } from "viem";

describe("Patch3QRegistryV5 decision deadline and rejection", () => {
  let connection: Awaited<ReturnType<typeof network.create>>;
  let v: typeof connection.viem;
  let wallets: Awaited<ReturnType<typeof v.getWalletClients>>;
  let token: Awaited<ReturnType<typeof v.deployContract>>;
  let registry: typeof token;
  const id = keccak256(toBytes("v5-review-case"));
  const envelope = keccak256(toBytes("encrypted-envelope"));
  const content = keccak256(toBytes("content-commitment"));
  const bundle = toHex("encrypted bundle bytes");
  const salt = keccak256(toBytes("private payout salt"));
  const reporterKey = "0x99999999";
  const rationale = keccak256(toBytes("salted rejection rationale"));
  const reserve = 1_000_000n;
  const payout = 700_000n;

  beforeEach(async () => {
    connection = await network.create(); v = connection.viem;
    wallets = await v.getWalletClients();
    token = await v.deployContract("MockTUSDT");
    registry = await v.deployContract("Patch3QRegistryV5Harness", [token.address]);
    for (let i = 0; i < 6; i++) await registry.write.setPqKey([wallets[i].account.address, toHex(`key-${i}`)]);
    await registry.write.configureProgramPolicy([
      [wallets[1].account.address, wallets[2].account.address, wallets[3].account.address], 2,
      [wallets[4].account.address], reserve, 1, 100n, 200n, 300n,
    ], { account: wallets[0].account });
    await token.write.mint([wallets[0].account.address, reserve]);
    await token.write.approve([registry.address, reserve], { account: wallets[0].account });
    await registry.write.depositProgramPool([reserve], { account: wallets[0].account });
    await submit(id);
  });
  afterEach(async () => { await connection.close(); });

  async function submit(caseId = id) {
    const commitment = await registry.read.payoutCommitmentOf([caseId, wallets[7].account.address, salt]);
    await registry.write.submitFundedAnonymousCase([
      wallets[0].account.address, caseId, envelope, content, keccak256(toBytes("program")),
      keccak256(reporterKey), commitment, bundle,
    ], { account: wallets[4].account });
  }
  async function triage() {
    await registry.write.acknowledgeCase([id], { account: wallets[0].account });
    await registry.write.triageCase([id], { account: wallets[0].account });
  }
  async function expire() {
    const [deadline] = await registry.read.decisionState([id]) as [bigint, boolean];
    const test = await v.getTestClient();
    await test.setNextBlockTimestamp({ timestamp: deadline + 1n });
    await test.mine({ blocks: 1 });
  }
  function approve(reporter = false) {
    return registry.write.approveAnonymousSeverity([
      id, 5, payout, rationale, wallets[7].account.address, salt, reporter ? reporterKey : "0x",
      "0xaaaa", [wallets[1].account.address, wallets[2].account.address], ["0xbbbb", "0xcccc"],
    ], { account: wallets[4].account });
  }
  function reject(indices = [1, 2], hash = rationale) {
    return registry.write.rejectAnonymousCase([
      id, hash, indices.map((i) => wallets[i].account.address), indices.map(() => "0xbbbb"),
    ], { account: wallets[5].account });
  }
  async function reverts(promise: Promise<unknown>, error: string) {
    await v.assertions.revertWithCustomError(promise, registry, error);
  }

  it("snapshots a decision deadline seven days after the triage deadline", async () => {
    const state = await registry.read.caseState([id]) as readonly unknown[];
    const decision = await registry.read.decisionState([id]) as [bigint, boolean];
    assert.equal(decision[0], (state[5] as bigint) + 7n * 86400n);
    assert.equal(decision[1], false);
  });
  it("allows a short decision grace only for subsequently accepted cases", async () => {
    const original = await registry.read.decisionState([id]);
    await registry.write.configureProgramPolicyWithDecisionGrace([
      [wallets[1].account.address, wallets[2].account.address, wallets[3].account.address], 2,
      [wallets[4].account.address], reserve, 2, 100n, 200n, 300n, 1n,
    ], { account: wallets[0].account });
    assert.deepEqual(await registry.read.decisionState([id]), original);
    await token.write.mint([wallets[0].account.address, reserve]);
    await token.write.approve([registry.address, reserve], { account: wallets[0].account });
    await registry.write.depositProgramPool([reserve], { account: wallets[0].account });
    const next = keccak256(toBytes("short grace case")); await submit(next);
    const receipt = await registry.read.caseState([next]) as readonly unknown[];
    assert.equal((await registry.read.decisionState([next]) as [bigint, boolean])[0], (receipt[5] as bigint) + 1n);
  });
  it("rejects zero or unbounded decision grace", async () => {
    for (const grace of [0n, 366n * 86400n]) await reverts(registry.write.configureProgramPolicyWithDecisionGrace([
      [wallets[1].account.address, wallets[2].account.address], 2, [wallets[4].account.address],
      reserve, 1, 100n, 200n, 300n, grace,
    ], { account: wallets[0].account }), "InvalidConfiguration");
  });
  it("keeps the existing seven-day grace through the compatible policy method", async () => {
    assert.equal(await registry.read.programDecisionGracePeriod([wallets[0].account.address]), 604800n);
  });
  it("cannot escalate a triaged case before its decision deadline", async () => {
    await triage();
    await reverts(registry.write.escalateMissedDeadline([id]), "DeadlineNotMissed");
  });
  it("replaces a program that ghosts after timely acknowledgement and triage", async () => {
    await triage(); await expire();
    assert.equal((await registry.read.decisionState([id]) as [bigint, boolean])[1], true);
    await registry.write.escalateMissedDeadline([id], { account: wallets[5].account });
    await approve(true);
    const state = await registry.read.caseState([id]) as readonly unknown[];
    assert.equal(state[0], 3); assert.equal(state[2], 4); assert.equal(state[3], 0n);
    assert.equal(await token.read.balanceOf([wallets[7].account.address]), payout);
  });
  it("also escalates a resolved case whose program has withheld payout approval", async () => {
    await triage(); await registry.write.resolveCase([id], { account: wallets[0].account }); await expire();
    await registry.write.escalateMissedDeadline([id]); await approve(true);
    assert.equal(await token.read.balanceOf([wallets[7].account.address]), payout);
  });
  it("blocks a late normal payout from racing permissionless escalation", async () => {
    await triage(); await expire(); await reverts(approve(), "DeadlineExpired");
  });
  it("blocks a late resolution from bypassing the decision deadline", async () => {
    await triage(); await expire();
    await reverts(registry.write.resolveCase([id], { account: wallets[0].account }), "DeadlineExpired");
  });
  it("accepts normal payout at the exact inclusive decision deadline", async () => {
    await triage();
    const [deadline] = await registry.read.decisionState([id]) as [bigint, boolean];
    await (await v.getTestClient()).setNextBlockTimestamp({ timestamp: deadline });
    await approve();
    assert.equal((await registry.read.decisionState([id]) as [bigint, boolean])[1], false);
    await reverts(registry.write.escalateMissedDeadline([id]), "DeadlineNotMissed");
  });
  it("returns the complete reserve and frees capacity after a quorum rejection", async () => {
    await reject();
    const state = await registry.read.caseState([id]) as readonly unknown[];
    const policy = await registry.read.programPolicyState([wallets[0].account.address]) as readonly unknown[];
    assert.equal(state[0], 6); assert.equal(state[3], 0n);
    assert.equal(policy[2], reserve); assert.equal(policy[5], 0);
    assert.equal(await token.read.balanceOf([registry.address]), reserve);
    assert.equal(await token.read.balanceOf([wallets[7].account.address]), 0n);
    await submit(keccak256(toBytes("next report")));
  });
  it("lets the quorum reject a triaged report without a program signature", async () => {
    await triage(); await reject();
    assert.equal((await registry.read.caseState([id]) as readonly unknown[])[0], 6);
  });
  it("lets the quorum reject an escalated invalid report without a reporter veto", async () => {
    await triage(); await expire(); await registry.write.escalateMissedDeadline([id]); await reject();
    assert.equal((await registry.read.programPolicyState([wallets[0].account.address]) as readonly unknown[])[2], reserve);
  });
  it("requires the full rejection quorum", async () => { await reverts(reject([1]), "AuditorQuorumNotMet"); });
  it("rejects duplicate rejection auditors", async () => { await reverts(reject([1, 1]), "DuplicateAuthority"); });
  it("rejects an unauthorized rejection auditor", async () => { await reverts(reject([1, 5]), "NotAuditor"); });
  it("rejects a classical-only or invalid PQ rejection signature", async () => {
    await registry.write.setPqSignatureValid([false]); await reverts(reject(), "InvalidPqSignature");
    assert.equal((await registry.read.programPolicyState([wallets[0].account.address]) as readonly unknown[])[2], 0n);
  });
  it("rejects an empty rationale commitment", async () => { await reverts(reject([1, 2], toHex(0n, { size: 32 })), "InvalidHash"); });
  it("cannot replay a rejection and return the same reserve twice", async () => {
    await reject(); await reverts(reject(), "ApprovalAlreadyRecorded");
    assert.equal((await registry.read.programPolicyState([wallets[0].account.address]) as readonly unknown[])[2], reserve);
  });
  it("cannot reject a case after its bounty was paid", async () => {
    await triage(); await approve(); await reverts(reject(), "ApprovalAlreadyRecorded");
  });
  it("cannot pay, escalate or disclose a rejected case", async () => {
    await reject(); await reverts(approve(), "InvalidStatus");
    await reverts(registry.write.escalateMissedDeadline([id]), "DeadlineNotMissed");
    await reverts(registry.write.discloseCase([id, rationale]), "InvalidStatus");
  });
  it("rejects a rotated rejection auditor and permits the remaining quorum", async () => {
    await registry.write.setPqKey([wallets[1].account.address, "0xdeadbeef"]);
    await reverts(reject([1, 2]), "AuditorKeyChanged"); await reject([2, 3]);
  });
  it("binds rejection to its registry, chain, evidence, quorum, reserve and rationale", async () => {
    const client = await v.getPublicClient();
    const typeHash = keccak256(toBytes("Patch3QV5Rejection(uint256 chainId,address registry,bytes32 caseIdHash,bytes32 envelopeHash,bytes32 contentCommitment,bytes32 bundleHash,bytes32 auditorSetHash,uint256 reservedAmount,bytes32 rationaleHash)"));
    const auditorSet = keccak256(encodeAbiParameters([{ type: "address[]" }, { type: "uint8" }], [[wallets[1].account.address, wallets[2].account.address, wallets[3].account.address], 2]));
    const expected = keccak256(encodeAbiParameters([
      { type: "bytes32" }, { type: "uint256" }, { type: "address" }, { type: "bytes32" },
      { type: "bytes32" }, { type: "bytes32" }, { type: "bytes32" }, { type: "bytes32" },
      { type: "uint256" }, { type: "bytes32" },
    ], [typeHash, BigInt(await client.getChainId()), registry.address, id, envelope, content, sha256(bundle), auditorSet, reserve, rationale]));
    assert.equal(await registry.read.rejectionDigest([id, rationale]), expected);
    assert.notEqual(await registry.read.rejectionDigest([id, keccak256(toBytes("other verdict"))]), expected);
  });
});
