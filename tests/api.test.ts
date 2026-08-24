import { describe, expect, it, vi } from "vitest";
import { Hono } from "hono";

vi.mock("../src/services/solana.ts", () => ({
  loadPayer: vi.fn().mockReturnValue({
    publicKey: { toBase58: () => "MockPayer123" },
    secretKey: new Uint8Array(64),
  }),
  ensurePayerFunded: vi.fn().mockResolvedValue(undefined),
  createTokenWithSupply: vi.fn().mockResolvedValue({
    payer: "MockPayer123",
    mintAddress: "MockMint456",
    tokenAccountAddress: "MockTokenAccount789",
    metadataAddress: "MockMetadata012",
    name: "TestCoin",
    symbol: "TEST",
    initialSupply: "1,000,000",
    transactionSignature: "MockTxSignature345",
    explorerUrl:
      "https://explorer.solana.com/address/MockMint456?cluster=devnet",
  }),
}));

vi.mock("../src/config.ts", () => ({
  config: {
    server: { port: 3000, apiKey: "test-api-key" },
    solana: { network: "devnet", commitment: "confirmed", rpcUrl: null },
  },
}));

const VALID_KEY = { "X-API-Key": "test-api-key" };

/** Sends POST /create-token against a freshly mounted app. */
async function post(headers?: Record<string, string>) {
  const { default: tokenRoutes } = await import("../src/routes/token.ts");
  const app = new Hono().route("/", tokenRoutes);
  const res = await app.fetch(
    new Request("http://localhost/create-token", { method: "POST", headers }),
  );
  return { res, body: (await res.json()) as Record<string, unknown> };
}

describe("POST /create-token", () => {
  it("rejects a request without an API key", async () => {
    const { res, body } = await post();

    expect(res.status).toBe(401);
    expect(body.error).toContain("API key required");
  });

  it("rejects a request with a wrong API key", async () => {
    const { res, body } = await post({ "X-API-Key": "wrong-key" });

    expect(res.status).toBe(403);
    expect(body.error).toBe("Invalid API key");
  });

  it.each([
    ["X-API-Key header", VALID_KEY],
    ["Authorization Bearer", { Authorization: "Bearer test-api-key" }],
  ])("accepts a valid API key via %s", async (_name, headers) => {
    const { res, body } = await post(headers);

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.network).toBe("devnet");
  });

  it("runs loadPayer, ensurePayerFunded and createTokenWithSupply in order", async () => {
    const { loadPayer, ensurePayerFunded, createTokenWithSupply } =
      await import("../src/services/solana.ts");

    await post(VALID_KEY);

    const order = (fn: unknown) =>
      (fn as { mock: { invocationCallOrder: number[] } }).mock
        .invocationCallOrder[0]!;

    expect(order(loadPayer)).toBeLessThan(order(ensurePayerFunded));
    expect(order(ensurePayerFunded)).toBeLessThan(order(createTokenWithSupply));
  });

  it.each([
    [new Error("Solana RPC error"), "Solana RPC error"],
    ["string error", "Unknown error"],
  ])("maps a thrown value to a 500 response", async (thrown, expected) => {
    const { createTokenWithSupply } = await import("../src/services/solana.ts");
    vi.mocked(createTokenWithSupply).mockRejectedValueOnce(thrown);

    const { res, body } = await post(VALID_KEY);

    expect(res.status).toBe(500);
    expect(body).toEqual({ success: false, error: expected });
  });
});
