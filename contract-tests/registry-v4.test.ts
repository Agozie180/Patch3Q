import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";

import { network } from "hardhat";
import { keccak256, sha256, toBytes, toHex } from "viem";

describe("Patch3QRegistryV4 funded policy and quorum", () => {
  let connection: Awaited<ReturnType<typeof network.create>>;
  let viem: Awaited<ReturnType<typeof network.create>>["viem"];
  let publicClient: Awaited<ReturnType<Awaited<ReturnType<typeof network.create>>["viem"]["getPublicClient"]>>;
  let program: Awaited<ReturnType<Awaited<ReturnType<typeof network.create>>["viem"]["getWalletClients"]>>[number];
  let auditorOne: typeof program;
  let auditorTwo: typeof program;
  let auditorThree: typeof program;
  let relayerOne: typeof program;
  let relayerTwo: typeof program;
  let outsider: typeof program;
  let payoutRecipient: typeof program;
  let token: Awaited<ReturnType<typeof viem.deployContract>>;
  let registry: Awaited<ReturnType<typeof viem.deployContract>>;

  const reservePerCase = 1_000_000_000n;
  const payoutAmount = 700_000_000n;
  const caseIdHash = keccak256(toBytes("P3Q-v4-funded-case"));
  const envelopeHash = keccak256(toBytes("v4-encrypted-envelope"));
  const contentCommitment = keccak256(toBytes("v4-content-commitment"));
  const programRef = keccak256(toBytes("v4-program-reference"));
  const reporterPqKey = "0x99999999" as const;
  const reporterPqKeyHash = keccak256(reporterPqKey);
  const payoutSalt = keccak256(toBytes("v4-payout-salt"));
  const rationaleHash = keccak256(toBytes("v4-critical-impact"));
  const encryptedBundle = toHex("ciphertext-only patch3q v4 bundle");

  beforeEach(async () => {
    connection = await network.create();
    viem = connection.viem;
    publicClient = await viem.getPublicClient();
    [program, auditorOne, auditorTwo, auditorThree, relayerOne, relayerTwo, outsider, payoutRecipient] =
      await viem.getWalletClients();
    token = await viem.deployContract("MockTUSDT");
    registry = await viem.deployContract("Patch3QRegistryV4Harness", [token.address]);

    const authorities = [
      [program, "0x11111111"],
      [auditorOne, "0x22222222"],
      [auditorTwo, "0x33333333"],
      [auditorThree, "0x44444444"],
      [relayerOne, "0x55555555"],
      [relayerTwo, "0x66666666"],
      [outsider, "0x77777777"],
    ] as const;
    for (const [wallet, key] of authorities) {
      await registry.write.setPqKey([wallet.account.address, key]);
    }
  });

  afterEach(async () => {
    await connection.close();
  });

  async function configurePolicy(maxOpenCases = 2) {
    await registry.write.configureProgramPolicy([[
      auditorOne.account.address,
      auditorTwo.account.address,
      auditorThree.account.address,
    ], 2, [relayerOne.account.address, relayerTwo.account.address], reservePerCase, maxOpenCases,
    100n, 200n, 300n], { account: program.account });
  }

  async function fundPool(amount = 2_000_000_000n) {
    await token.write.mint([program.account.address, amount]);
    await token.write.approve([registry.address, amount], { account: program.account });
    await registry.write.depositProgramPool([amount], { account: program.account });
  }

  async function submitFundedCase(id = caseIdHash) {
    const commitment = await registry.read.payoutCommitmentOf([
      id, payoutRecipient.account.address, payoutSalt,
    ]);
    await registry.write.submitFundedAnonymousCase([
      program.account.address,
      id,
      envelopeHash,
      contentCommitment,
      programRef,
      reporterPqKeyHash,
      commitment,
      encryptedBundle,
    ], { account: relayerOne.account });
    return commitment;
  }

  async function configureFundAndSubmit() {
    await configurePolicy();
    await fundPool();
    return submitFundedCase();
  }

  async function acknowledgeAndTriage() {
    await registry.write.acknowledgeCase([caseIdHash], { account: program.account });
    await registry.write.triageCase([caseIdHash], { account: program.account });
  }

  async function approve(auditors = [auditorOne, auditorTwo], reporterKey: `0x${string}` = "0x") {
    await registry.write.approveAnonymousSeverity([
      caseIdHash,
      5,
      payoutAmount,
      rationaleHash,
      payoutRecipient.account.address,
      payoutSalt,
      reporterKey,
      "0xaaaa",
      auditors.map((wallet) => wallet.account.address),
      auditors.map((_wallet, index) => index === 0 ? "0xbbbb" : "0xcccc"),
    ], { account: relayerTwo.account });
  }

  it("pre-funds a program policy before any report exists", async () => {
    await configurePolicy();
    await fundPool();
    const state = await registry.read.programPolicyState([program.account.address]);
    assert.equal(state[0], true);
    assert.equal(state[1], true);
    assert.equal(state[2], 2_000_000_000n);
    assert.equal(state[3], reservePerCase);
    assert.equal(state[6], 2);
    assert.equal(state[7], 3n);
    assert.equal(state[8], 2n);
  });

  it("lets only an authorized PQ-registered relayer reserve a funded case", async () => {
    await configurePolicy();
    await fundPool();
    const commitment = await registry.read.payoutCommitmentOf([
      caseIdHash, payoutRecipient.account.address, payoutSalt,
    ]);
    await viem.assertions.revertWithCustomError(
      registry.write.submitFundedAnonymousCase([
        program.account.address, caseIdHash, envelopeHash, contentCommitment, programRef,
        reporterPqKeyHash, commitment, encryptedBundle,
      ], { account: outsider.account }),
      registry,
      "NotRelayer",
    );
    await submitFundedCase();
    const policy = await registry.read.programPolicyState([program.account.address]);
    const state = await registry.read.caseState([caseIdHash]);
    assert.equal(policy[2], 1_000_000_000n);
    assert.equal(policy[5], 1);
    assert.equal(state[3], reservePerCase);
    assert.equal(state[11], sha256(encryptedBundle));
    assert.equal(state[12], 2);
  });

  it("cannot create a case when the pre-funded pool is empty", async () => {
    await configurePolicy();
    const commitment = await registry.read.payoutCommitmentOf([
      caseIdHash, payoutRecipient.account.address, payoutSalt,
    ]);
    await viem.assertions.revertWithCustomError(
      registry.write.submitFundedAnonymousCase([
        program.account.address, caseIdHash, envelopeHash, contentCommitment, programRef,
        reporterPqKeyHash, commitment, encryptedBundle,
      ], { account: relayerOne.account }),
      registry,
      "InsufficientProgramPool",
    );
  });

  it("enforces the configured open-case capacity", async () => {
    await configurePolicy(1);
    await fundPool();
    await submitFundedCase();
    const secondId = keccak256(toBytes("P3Q-v4-second-case"));
    const commitment = await registry.read.payoutCommitmentOf([
      secondId, payoutRecipient.account.address, payoutSalt,
    ]);
    await viem.assertions.revertWithCustomError(
      registry.write.submitFundedAnonymousCase([
        program.account.address, secondId, envelopeHash, contentCommitment, programRef,
        reporterPqKeyHash, commitment, encryptedBundle,
      ], { account: relayerOne.account }),
      registry,
      "CaseCapacityReached",
    );
  });

  it("requires a program signature plus the configured 2-of-3 auditor quorum", async () => {
    await configureFundAndSubmit();
    await acknowledgeAndTriage();
    await viem.assertions.revertWithCustomError(
      approve([auditorOne]),
      registry,
      "AuditorQuorumNotMet",
    );
    await approve([auditorOne, auditorTwo]);

    const state = await registry.read.caseState([caseIdHash]);
    const policy = await registry.read.programPolicyState([program.account.address]);
    assert.equal(Number(state[0]), 3);
    assert.equal(state[3], 0n);
    assert.equal(policy[2], 1_300_000_000n);
    assert.equal(policy[5], 0);
    assert.equal(await token.read.balanceOf([payoutRecipient.account.address]), payoutAmount);
  });

  it("replaces the ghosted program with the reporter key after permissionless escalation", async () => {
    await configureFundAndSubmit();
    const stateBefore = await registry.read.caseState([caseIdHash]);
    const testClient = await viem.getTestClient();
    await testClient.setNextBlockTimestamp({ timestamp: stateBefore[4] + 1n });
    await testClient.mine({ blocks: 1 });

    await viem.assertions.revertWithCustomError(
      registry.write.acknowledgeCase([caseIdHash], { account: program.account }),
      registry,
      "DeadlineExpired",
    );
    await registry.write.escalateMissedDeadline([caseIdHash], { account: outsider.account });
    await approve([auditorTwo, auditorThree], reporterPqKey);
    const state = await registry.read.caseState([caseIdHash]);
    assert.equal(Number(state[0]), 3);
    assert.equal(Number(state[2]) & 1, 1);
    assert.equal(await token.read.balanceOf([payoutRecipient.account.address]), payoutAmount);
  });

  it("keeps quorum live when one snapshotted auditor rotates or disappears", async () => {
    await configureFundAndSubmit();
    await acknowledgeAndTriage();
    await registry.write.setPqKey([auditorOne.account.address, "0xdeadbeef"]);
    await approve([auditorTwo, auditorThree]);
    assert.equal(await token.read.balanceOf([payoutRecipient.account.address]), payoutAmount);
  });

  it("rejects a rotated auditor when that auditor is used", async () => {
    await configureFundAndSubmit();
    await acknowledgeAndTriage();
    await registry.write.setPqKey([auditorOne.account.address, "0xdeadbeef"]);
    await viem.assertions.revertWithCustomError(
      approve([auditorOne, auditorTwo]),
      registry,
      "AuditorKeyChanged",
    );
  });

  it("rejects duplicate or unauthorized quorum members", async () => {
    await configureFundAndSubmit();
    await acknowledgeAndTriage();
    await viem.assertions.revertWithCustomError(
      approve([auditorOne, auditorOne]),
      registry,
      "DuplicateAuthority",
    );
    await viem.assertions.revertWithCustomError(
      approve([auditorOne, outsider]),
      registry,
      "NotAuditor",
    );
  });

  it("snapshots a case's auditor set across later policy changes", async () => {
    await configureFundAndSubmit();
    await registry.write.configureProgramPolicy([[
      auditorTwo.account.address,
      auditorThree.account.address,
      outsider.account.address,
    ], 2, [relayerOne.account.address, relayerTwo.account.address], reservePerCase, 2,
    100n, 200n, 300n], { account: program.account });
    await acknowledgeAndTriage();
    await approve([auditorOne, auditorTwo]);
    assert.equal(await token.read.balanceOf([payoutRecipient.account.address]), payoutAmount);
  });

  it("does not let both legitimate signers redirect the sealed payout", async () => {
    await configureFundAndSubmit();
    await acknowledgeAndTriage();
    await viem.assertions.revertWithCustomError(
      registry.write.approveAnonymousSeverity([
        caseIdHash, 5, payoutAmount, rationaleHash, outsider.account.address, payoutSalt,
        "0x", "0xaaaa", [auditorOne.account.address, auditorTwo.account.address], ["0xbbbb", "0xcccc"],
      ], { account: relayerTwo.account }),
      registry,
      "PayoutCommitmentMismatch",
    );
  });

  it("allows withdrawal only from the unreserved program pool", async () => {
    await configureFundAndSubmit();
    await viem.assertions.revertWithCustomError(
      registry.write.withdrawProgramPool([1_000_000_001n], { account: program.account }),
      registry,
      "InvalidAmount",
    );
    await registry.write.withdrawProgramPool([1_000_000_000n], { account: program.account });
    const policy = await registry.read.programPolicyState([program.account.address]);
    const state = await registry.read.caseState([caseIdHash]);
    assert.equal(policy[2], 0n);
    assert.equal(state[3], reservePerCase);
  });

  it("rejects fee-on-transfer deposits instead of creating an underfunded pool", async () => {
    const feeToken = await viem.deployContract("FeeOnTransferToken");
    const feeRegistry = await viem.deployContract("Patch3QRegistryV4Harness", [feeToken.address]);
    for (const [wallet, key] of [
      [program, "0x11111111"], [auditorOne, "0x22222222"], [auditorTwo, "0x33333333"],
      [relayerOne, "0x55555555"],
    ] as const) {
      await feeRegistry.write.setPqKey([wallet.account.address, key]);
    }
    await feeRegistry.write.configureProgramPolicy([[
      auditorOne.account.address, auditorTwo.account.address,
    ], 2, [relayerOne.account.address], reservePerCase, 1, 100n, 200n, 300n], { account: program.account });
    await feeToken.write.mint([program.account.address, reservePerCase]);
    await feeToken.write.approve([feeRegistry.address, reservePerCase], { account: program.account });
    await viem.assertions.revertWithCustomError(
      feeRegistry.write.depositProgramPool([reservePerCase], { account: program.account }),
      feeRegistry,
      "TokenBalanceMismatch",
    );
  });
});
