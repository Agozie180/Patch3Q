import { beforeEach, describe, expect, it, vi } from "vitest";
import { sha256 } from "viem";

import publishedBundle from "../evidence/cases-v4/funded-quorum.bundle.json";
import { parseBundle } from "../src/lib/patch3q.js";
import { fetchV4Bundle, v4BundleHex } from "../src/lib/v4-bundle.js";

const rpc = vi.hoisted(() => ({ getBlockNumber: vi.fn(), getContractEvents: vi.fn() }));
vi.mock("viem", async (importOriginal) => ({
  ...await importOriginal<typeof import("viem")>(),
  createPublicClient: () => rpc,
}));

const registryAddress = "0xd3b5f8af4de51a33d4790a2cfb41231f825be9c3";
const fromBlock = 10_622_404n;
const bundle = parseBundle(JSON.stringify(publishedBundle));
const transactionHash = "0x87351ae1fa8c26cd0b68b21e198734087516eba2b0bdd8cedd6a65d2355dba8b";

describe("V4 encrypted delivery recovery", () => {
  beforeEach(() => vi.resetAllMocks());

  it("finds an older delivery without exceeding or overlapping RPC windows", async () => {
    const encryptedBundle = await v4BundleHex(bundle);
    const bundleHash = sha256(encryptedBundle);
    rpc.getBlockNumber.mockResolvedValue(10_640_403n);
    rpc.getContractEvents.mockResolvedValueOnce([]).mockResolvedValueOnce([
      { args: { encryptedBundle, bundleHash }, transactionHash },
    ]);

    await expect(fetchV4Bundle({ registryAddress, caseId: bundle.caseId, fromBlock })).resolves.toEqual({
      bundle, bundleHash, transactionHash,
    });
    expect(rpc.getContractEvents).toHaveBeenCalledTimes(2);
    expect(rpc.getContractEvents).toHaveBeenNthCalledWith(1, expect.objectContaining({
      address: registryAddress, fromBlock: 10_631_404n, toBlock: 10_640_403n,
    }));
    expect(rpc.getContractEvents).toHaveBeenNthCalledWith(2, expect.objectContaining({
      fromBlock, toBlock: 10_631_403n,
    }));
  });

  it("stops at the registry deployment block when a case has no delivery", async () => {
    rpc.getBlockNumber.mockResolvedValue(fromBlock + 2n);
    rpc.getContractEvents.mockResolvedValue([]);

    await expect(fetchV4Bundle({ registryAddress, caseId: bundle.caseId, fromBlock }))
      .rejects.toThrow("No V4 encrypted bundle event");
    expect(rpc.getContractEvents).toHaveBeenCalledTimes(1);
    expect(rpc.getContractEvents).toHaveBeenCalledWith(expect.objectContaining({
      fromBlock, toBlock: fromBlock + 2n,
    }));
  });

  it("rejects a delivery whose published bytes do not match its commitment", async () => {
    rpc.getBlockNumber.mockResolvedValue(fromBlock);
    rpc.getContractEvents.mockResolvedValue([{
      args: { encryptedBundle: "0x01", bundleHash: sha256("0x02") }, transactionHash,
    }]);

    await expect(fetchV4Bundle({ registryAddress, caseId: bundle.caseId, fromBlock }))
      .rejects.toThrow("do not match their on-chain SHA-256");
  });
});
