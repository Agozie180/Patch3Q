import { afterEach, describe, expect, it, vi } from "vitest";

import { GET } from "../api/lcd-testnet";

const address = "qor1hfxnr2fr4camsk54qmvjjlkdfddgt9gpmu6fwv";
const call = (path: string) => GET(new Request(`https://patch3q.example/api/lcd-testnet?path=${encodeURIComponent(path)}`));

describe("hosted Diana REST proxy", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("forwards ML-KEM and PQC account lookups to the fixed Diana upstream", async () => {
    const fetchMock = vi.fn(async () => new Response('{"found":true}', { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    for (const kind of ["kem", "account"]) {
      const response = await call(`qorechain/pqc/v1/${kind}/${address}`);
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ found: true });
    }
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      `https://api-testnet.qore.host/qorechain/pqc/v1/kem/${address}`,
      `https://api-testnet.qore.host/qorechain/pqc/v1/account/${address}`,
    ]);
  });

  it.each([
    "cosmos/bank/v1beta1/balances/" + address,
    "qorechain/pqc/v1/kem/" + address + "/../../../cosmos",
    "qorechain/pqc/v1/kem/0xBa4D31a923aE3Bb85A9506D9297ecd4B5a859501",
    "//evil.example/qorechain/pqc/v1/kem/" + address,
    "",
  ])("refuses %j without contacting the network", async (path) => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    expect((await call(path)).status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
