import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";

import { network } from "hardhat";
import { encodeAbiParameters, keccak256, toBytes, zeroHash } from "viem";

describe("Patch3QRegistry foundation", () => {
  let connection: Awaited<ReturnType<typeof network.create>>;
  let viem: Awaited<ReturnType<typeof network.create>>["viem"];
  let publicClient: Awaited<ReturnType<Awaited<ReturnType<typeof network.create>>["viem"]["getPublicClient"]>>;
  let reporter: Awaited<ReturnType<Awaited<ReturnType<typeof network.create>>["viem"]["getWalletClients"]>>[number];
  let program: typeof reporter;
  let auditor: typeof reporter;
  let outsider: typeof reporter;
  let token: Awaited<ReturnType<typeof viem.deployContract>>;
  let registry: Awaited<ReturnType<typeof viem.deployContract>>;

  const caseIdHash = keccak256(toBytes("P3Q-foundation-case"));
  const envelopeHash = keccak256(toBytes("encrypted-envelope"));
  const contentCommitment = keccak256(toBytes("salted-confidential-report"));
  const programRef = keccak256(toBytes("program-reference"));
  const rationaleHash = keccak256(toBytes("critical impact and direct loss"));

  beforeEach(async () => {
    connection = await network.create();
    viem = connection.viem;
    publicClient = await viem.getPublicClient();
    [reporter, program, auditor, outsider] = await viem.getWalletClients();
    token = await viem.deployContract("MockTUSDT");
    registry = await viem.deployContract("Patch3QRegistryHarness", [token.address]);
    await registry.write.setPqKey([reporter.account.address, "0x11111111"]);
    await registry.write.setPqKey([program.account.address, "0x22222222"]);
    await registry.write.setPqKey([auditor.account.address, "0x12345678"]);
  });

  afterEach(async () => {
    await connection.close();
  });

  async function submitCase() {
    const block = await publicClient.getBlock();
    const acknowledgeBy = block.timestamp + 86_400n;
    const triageBy = block.timestamp + 7n * 86_400n;
    const embargoUntil = block.timestamp + 30n * 86_400n;
    await registry.write.submitCase([
      program.account.address,
      auditor.account.address,
      caseIdHash,
      envelopeHash,
      contentCommitment,
      programRef,
      acknowledgeBy,
      triageBy,
      embargoUntil,
    ], { account: reporter.account });
    return { acknowledgeBy, triageBy, embargoUntil };
  }

  async function triageAndFund(amount = 2_500_000_000n) {
    await submitCase();
    await registry.write.acknowledgeCase([caseIdHash], { account: program.account });
    await registry.write.triageCase([caseIdHash], { account: program.account });
    await token.write.mint([program.account.address, amount]);
    await token.write.approve([registry.address, amount], { account: program.account });
    await registry.write.fundBounty([caseIdHash, amount], { account: program.account });
    return amount;
  }

  it("requires reporter, program, and auditor to be distinct", async () => {
    const block = await publicClient.getBlock();
    await viem.assertions.revertWithCustomError(
      registry.write.submitCase([
        reporter.account.address,
        auditor.account.address,
        caseIdHash,
        envelopeHash,
        contentCommitment,
        programRef,
        block.timestamp + 100n,
        block.timestamp + 200n,
        block.timestamp + 300n,
      ], { account: reporter.account }),
      registry,
      "RolesMustBeDistinct",
    );
  });

  it("records deadline breaches on-chain even when the program acts late", async () => {
    const { acknowledgeBy } = await submitCase();
    const testClient = await viem.getTestClient();
    await testClient.setNextBlockTimestamp({ timestamp: acknowledgeBy + 1n });
    await testClient.mine({ blocks: 1 });
    await registry.write.acknowledgeCase([caseIdHash], { account: program.account });
    const state = await registry.read.caseState([caseIdHash]);
    assert.equal(Number(state[2]) & 1, 1);
    assert.equal(Number(state[0]), 1);
  });

  it("turns a missed acknowledgement into a permissionless escalation consequence", async () => {
    const { acknowledgeBy } = await submitCase();
    const testClient = await viem.getTestClient();
    await testClient.setNextBlockTimestamp({ timestamp: acknowledgeBy + 1n });
    await testClient.mine({ blocks: 1 });

    await registry.write.escalateMissedDeadline([caseIdHash], { account: outsider.account });
    const state = await registry.read.caseState([caseIdHash]);
    assert.equal(Number(state[0]), 6);
    assert.equal(Number(state[2]) & 1, 1);
  });

  it("does not let a late program undo acknowledgement escalation", async () => {
    const { acknowledgeBy } = await submitCase();
    const testClient = await viem.getTestClient();
    await testClient.setNextBlockTimestamp({ timestamp: acknowledgeBy + 1n });
    await testClient.mine({ blocks: 1 });
    await registry.write.escalateMissedDeadline([caseIdHash], { account: outsider.account });

    await viem.assertions.revertWithCustomError(
      registry.write.acknowledgeCase([caseIdHash], { account: program.account }),
      registry,
      "InvalidStatus",
    );
  });

  it("cannot escalate while the active deadline is still open", async () => {
    await submitCase();
    await viem.assertions.revertWithCustomError(
      registry.write.escalateMissedDeadline([caseIdHash], { account: outsider.account }),
      registry,
      "DeadlineNotMissed",
    );
  });

  it("escalates a missed triage after a timely acknowledgement", async () => {
    const { triageBy } = await submitCase();
    await registry.write.acknowledgeCase([caseIdHash], { account: program.account });
    const testClient = await viem.getTestClient();
    await testClient.setNextBlockTimestamp({ timestamp: triageBy + 1n });
    await testClient.mine({ blocks: 1 });
    await registry.write.escalateMissedDeadline([caseIdHash], { account: outsider.account });
    const state = await registry.read.caseState([caseIdHash]);
    assert.equal(Number(state[0]), 6);
    assert.equal(Number(state[2]) & 2, 2);
  });

  it("does not let a late program undo triage escalation", async () => {
    const { triageBy } = await submitCase();
    await registry.write.acknowledgeCase([caseIdHash], { account: program.account });
    const testClient = await viem.getTestClient();
    await testClient.setNextBlockTimestamp({ timestamp: triageBy + 1n });
    await testClient.mine({ blocks: 1 });
    await registry.write.escalateMissedDeadline([caseIdHash], { account: outsider.account });

    await viem.assertions.revertWithCustomError(
      registry.write.triageCase([caseIdHash], { account: program.account }),
      registry,
      "InvalidStatus",
    );
  });

  it("lets the independent auditor adjudicate funded escrow after escalation", async () => {
    const { acknowledgeBy } = await submitCase();
    const payout = 1_000_000_000n;
    await token.write.mint([program.account.address, payout]);
    await token.write.approve([registry.address, payout], { account: program.account });
    await registry.write.fundBounty([caseIdHash, payout], { account: program.account });
    const testClient = await viem.getTestClient();
    await testClient.setNextBlockTimestamp({ timestamp: acknowledgeBy + 1n });
    await testClient.mine({ blocks: 1 });
    await registry.write.escalateMissedDeadline([caseIdHash], { account: outsider.account });

    await registry.write.setPqKeySignatureValid(["0x11111111", true]);
    await registry.write.setPqKeySignatureValid(["0x22222222", false]);
    await registry.write.setPqKeySignatureValid(["0x12345678", true]);

    await registry.write.approveSeverity([
      caseIdHash,
      5,
      payout,
      rationaleHash,
      "0x5678",
      "0x1234",
    ], { account: auditor.account });
    assert.equal(await token.read.balanceOf([reporter.account.address]), payout);
  });

  it("rejects payout when the post-quantum signature fails", async () => {
    const amount = await triageAndFund();
    await registry.write.setPqSignatureValid([false]);
    await viem.assertions.revertWithCustomError(
      registry.write.approveSeverity([
        caseIdHash,
        5,
        amount,
        rationaleHash,
        "0x5678",
        "0x1234",
      ], { account: auditor.account }),
      registry,
      "InvalidPqSignature",
    );
  });

  it("requires both independent PQ signatures", async () => {
    const amount = await triageAndFund();
    await viem.assertions.revertWithCustomError(
      registry.write.approveSeverity([
        caseIdHash,
        5,
        amount,
        rationaleHash,
        "0x5678",
        "0x",
      ], { account: auditor.account }),
      registry,
      "InvalidHash",
    );
  });

  it("computes the exact replay-protected approval digest", async () => {
    await submitCase();
    const payout = 1_000_000_000n;
    const severity = 5;
    const approvalTypehash = keccak256(toBytes(
      "Patch3QSeverityApproval(uint256 chainId,address registry,bytes32 caseIdHash,bytes32 envelopeHash,bytes32 contentCommitment,uint8 severity,uint256 payoutAmount,bytes32 rationaleHash)",
    ));
    const expected = keccak256(encodeAbiParameters(
      [
        { type: "bytes32" },
        { type: "uint256" },
        { type: "address" },
        { type: "bytes32" },
        { type: "bytes32" },
        { type: "bytes32" },
        { type: "uint8" },
        { type: "uint256" },
        { type: "bytes32" },
      ],
      [
        approvalTypehash,
        BigInt(await publicClient.getChainId()),
        registry.address,
        caseIdHash,
        envelopeHash,
        contentCommitment,
        severity,
        payout,
        rationaleHash,
      ],
    ));

    assert.equal(
      await registry.read.approvalDigest([caseIdHash, severity, payout, rationaleHash]),
      expected,
    );
  });

  it("rejects approval if the auditor rotates away from the key bound at submission", async () => {
    const amount = await triageAndFund();
    await registry.write.setPqKey([auditor.account.address, "0x87654321"]);
    await viem.assertions.revertWithCustomError(
      registry.write.approveSeverity([
        caseIdHash,
        5,
        amount,
        rationaleHash,
        "0x5678",
        "0x1234",
      ], { account: auditor.account }),
      registry,
      "AuditorPqKeyChanged",
    );
  });

  it("releases only the PQ-approved amount and stores the replay-protected digest", async () => {
    const amount = await triageAndFund();
    const payout = 1_000_000_000n;
    await registry.write.approveSeverity([
      caseIdHash,
      5,
      payout,
      rationaleHash,
      "0x5678",
      "0x1234",
    ], { account: auditor.account });

    assert.equal(await token.read.balanceOf([reporter.account.address]), payout);
    const state = await registry.read.caseState([caseIdHash]);
    assert.equal(state[3], amount - payout);
    assert.notEqual(state[10], zeroHash);
  });

  it("blocks unauthorized lifecycle transitions", async () => {
    await submitCase();
    await viem.assertions.revertWithCustomError(
      registry.write.acknowledgeCase([caseIdHash], { account: outsider.account }),
      registry,
      "NotProgram",
    );
  });

  it("rejects a normal payout after the program rotates its bound PQ key", async () => {
    const amount = await triageAndFund();
    await registry.write.setPqKey([program.account.address, "0x99999999"]);
    await viem.assertions.revertWithCustomError(
      registry.write.approveSeverity([
        caseIdHash,
        5,
        amount,
        rationaleHash,
        "0x5678",
        "0x1234",
      ], { account: auditor.account }),
      registry,
      "ProgramPqKeyChanged",
    );
  });

  it("rejects an escalated payout after the reporter rotates its bound PQ key", async () => {
    const { acknowledgeBy } = await submitCase();
    const payout = 1_000_000_000n;
    await token.write.mint([program.account.address, payout]);
    await token.write.approve([registry.address, payout], { account: program.account });
    await registry.write.fundBounty([caseIdHash, payout], { account: program.account });
    const testClient = await viem.getTestClient();
    await testClient.setNextBlockTimestamp({ timestamp: acknowledgeBy + 1n });
    await testClient.mine({ blocks: 1 });
    await registry.write.escalateMissedDeadline([caseIdHash], { account: outsider.account });
    await registry.write.setPqKey([reporter.account.address, "0x99999999"]);

    await viem.assertions.revertWithCustomError(
      registry.write.approveSeverity([
        caseIdHash,
        5,
        payout,
        rationaleHash,
        "0x5678",
        "0x1234",
      ], { account: auditor.account }),
      registry,
      "ReporterPqKeyChanged",
    );
  });

  describe("anonymous reporter mode", () => {
    const reporterPqKey = "0xabcdef0102" as const;
    const reporterPqKeyHash = keccak256(reporterPqKey);
    const payoutSalt = keccak256(toBytes("sealed payout salt"));
    const payoutTypehash = keccak256(toBytes(
      "Patch3QPayoutCommitment(bytes32 caseIdHash,address payoutRecipient,bytes32 salt)",
    ));
    let payoutRecipient: `0x${string}`;
    let payoutCommitment: `0x${string}`;

    beforeEach(async () => {
      const wallets = await viem.getWalletClients();
      payoutRecipient = wallets[5].account.address;
      payoutCommitment = keccak256(encodeAbiParameters(
        [{ type: "bytes32" }, { type: "bytes32" }, { type: "address" }, { type: "bytes32" }],
        [payoutTypehash, caseIdHash, payoutRecipient, payoutSalt],
      ));
    });

    async function submitAnonymous(relayer = outsider) {
      const block = await publicClient.getBlock();
      const acknowledgeBy = block.timestamp + 86_400n;
      await registry.write.submitAnonymousCase([
        program.account.address,
        auditor.account.address,
        caseIdHash,
        envelopeHash,
        contentCommitment,
        programRef,
        acknowledgeBy,
        block.timestamp + 7n * 86_400n,
        block.timestamp + 30n * 86_400n,
        reporterPqKeyHash,
        payoutCommitment,
      ], { account: relayer.account });
      return { acknowledgeBy };
    }

    async function fund(amount = 2_000_000_000n) {
      await token.write.mint([program.account.address, amount]);
      await token.write.approve([registry.address, amount], { account: program.account });
      await registry.write.fundBounty([caseIdHash, amount], { account: program.account });
      return amount;
    }

    function anonymousApprove(
      recipient: `0x${string}`,
      payout: bigint,
      key: `0x${string}` = "0x",
      salt: `0x${string}` = payoutSalt,
    ) {
      return registry.write.approveAnonymousSeverity([
        caseIdHash, 5, payout, rationaleHash, recipient, salt, key, "0x5678", "0x1234",
      ], { account: auditor.account });
    }

    it("anchors without any reporter account and needs no registered reporter key", async () => {
      await submitAnonymous();
      const state = await registry.read.caseState([caseIdHash]);
      assert.equal(state[7], "0x0000000000000000000000000000000000000000");
      const privacy = await registry.read.privacyState([caseIdHash]);
      assert.equal(privacy[0], true);
      assert.equal(privacy[1].toLowerCase(), outsider.account.address.toLowerCase());
      assert.equal(privacy[2], reporterPqKeyHash);
      assert.equal(privacy[3], payoutCommitment);
    });

    it("requires a reporter key commitment and a payout commitment", async () => {
      const block = await publicClient.getBlock();
      await viem.assertions.revertWithCustomError(
        registry.write.submitAnonymousCase([
          program.account.address, auditor.account.address, caseIdHash, envelopeHash, contentCommitment,
          programRef, block.timestamp + 100n, block.timestamp + 200n, block.timestamp + 300n,
          reporterPqKeyHash, zeroHash,
        ], { account: outsider.account }),
        registry,
        "InvalidHash",
      );
    });

    it("pays the sealed payout address, never the relayer", async () => {
      await submitAnonymous();
      await registry.write.acknowledgeCase([caseIdHash], { account: program.account });
      await registry.write.triageCase([caseIdHash], { account: program.account });
      const amount = await fund();
      await anonymousApprove(payoutRecipient, amount);
      assert.equal(await token.read.balanceOf([payoutRecipient]), amount);
      assert.equal(await token.read.balanceOf([outsider.account.address]), 0n);
    });

    it("stops the program and auditor from redirecting the bounty", async () => {
      await submitAnonymous();
      await registry.write.acknowledgeCase([caseIdHash], { account: program.account });
      await registry.write.triageCase([caseIdHash], { account: program.account });
      const amount = await fund();
      await viem.assertions.revertWithCustomError(
        anonymousApprove(auditor.account.address, amount),
        registry,
        "PayoutCommitmentMismatch",
      );
      await viem.assertions.revertWithCustomError(
        anonymousApprove(payoutRecipient, amount, "0x", keccak256(toBytes("guessed salt"))),
        registry,
        "PayoutCommitmentMismatch",
      );
    });

    it("lets the per-case reporter key co-sign after a ghosted deadline", async () => {
      const { acknowledgeBy } = await submitAnonymous();
      const amount = await fund();
      const testClient = await viem.getTestClient();
      await testClient.setNextBlockTimestamp({ timestamp: acknowledgeBy + 1n });
      await testClient.mine({ blocks: 1 });
      await registry.write.escalateMissedDeadline([caseIdHash], { account: outsider.account });

      await registry.write.setPqKeySignatureValid([reporterPqKey, true]);
      await registry.write.setPqKeySignatureValid(["0x22222222", false]);
      await registry.write.setPqKeySignatureValid(["0x12345678", true]);
      await viem.assertions.revertWithCustomError(
        anonymousApprove(payoutRecipient, amount, "0x22222222"),
        registry,
        "ReporterPqKeyChanged",
      );
      await anonymousApprove(payoutRecipient, amount, reporterPqKey);
      assert.equal(await token.read.balanceOf([payoutRecipient]), amount);
    });

    it("keeps account and anonymous approval paths separate", async () => {
      await submitAnonymous();
      await registry.write.acknowledgeCase([caseIdHash], { account: program.account });
      await registry.write.triageCase([caseIdHash], { account: program.account });
      const amount = await fund();
      await viem.assertions.revertWithCustomError(
        registry.write.approveSeverity([caseIdHash, 5, amount, rationaleHash, "0x5678", "0x1234"], {
          account: auditor.account,
        }),
        registry,
        "AnonymousCaseRequired",
      );
    });

    it("rejects the anonymous path for an account-based case", async () => {
      const amount = await triageAndFund();
      await viem.assertions.revertWithCustomError(
        anonymousApprove(payoutRecipient, amount),
        registry,
        "AccountCaseRequired",
      );
    });

    it("binds the payout recipient into the replay-protected anonymous digest", async () => {
      await submitAnonymous();
      const typehash = keccak256(toBytes(
        "Patch3QAnonymousSeverityApproval(uint256 chainId,address registry,bytes32 caseIdHash,bytes32 envelopeHash,bytes32 contentCommitment,uint8 severity,uint256 payoutAmount,bytes32 rationaleHash,address payoutRecipient)",
      ));
      const expected = keccak256(encodeAbiParameters(
        [
          { type: "bytes32" }, { type: "uint256" }, { type: "address" }, { type: "bytes32" }, { type: "bytes32" },
          { type: "bytes32" }, { type: "uint8" }, { type: "uint256" }, { type: "bytes32" }, { type: "address" },
        ],
        [
          typehash, BigInt(await publicClient.getChainId()), registry.address, caseIdHash, envelopeHash,
          contentCommitment, 5, 1_000n, rationaleHash, payoutRecipient,
        ],
      ));
      assert.equal(
        await registry.read.anonymousApprovalDigest([caseIdHash, 5, 1_000n, rationaleHash, payoutRecipient]),
        expected,
      );
      assert.equal(
        await registry.read.payoutCommitmentOf([caseIdHash, payoutRecipient, payoutSalt]),
        payoutCommitment,
      );
    });
  });

  it("rejects fee-on-transfer tokens instead of creating unbacked escrow", async () => {
    const feeToken = await viem.deployContract("FeeOnTransferToken");
    const strictRegistry = await viem.deployContract("Patch3QRegistryHarness", [feeToken.address]);
    await strictRegistry.write.setPqKey([reporter.account.address, "0x11111111"]);
    await strictRegistry.write.setPqKey([program.account.address, "0x22222222"]);
    await strictRegistry.write.setPqKey([auditor.account.address, "0x12345678"]);
    const block = await publicClient.getBlock();
    await strictRegistry.write.submitCase([
      program.account.address,
      auditor.account.address,
      caseIdHash,
      envelopeHash,
      contentCommitment,
      programRef,
      block.timestamp + 100n,
      block.timestamp + 200n,
      block.timestamp + 300n,
    ], { account: reporter.account });
    await feeToken.write.mint([program.account.address, 1_000n]);
    await feeToken.write.approve([strictRegistry.address, 1_000n], { account: program.account });
    await viem.assertions.revertWithCustomError(
      strictRegistry.write.fundBounty([caseIdHash, 1_000n], { account: program.account }),
      strictRegistry,
      "TokenBalanceMismatch",
    );
  });
});
