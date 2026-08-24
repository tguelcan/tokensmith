import { describe, expect, it, vi } from "vitest";
import { Hono } from "hono";

// mockReset in vitest.config.ts discards mockReturnValue, but keeps a vi.fn(impl).
vi.mock("../src/services/solana.ts", () => ({
  loadPayer: vi.fn(() => ({
    publicKey: { toBase58: () => "MockPayer123" },
    secretKey: new Uint8Array(64),
  })),
  ensurePayerFunded: vi.fn(async () => undefined),
  createTokenWithSupply: vi.fn(async () => ({
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
  })),
  updateTokenMetadata: vi.fn(async () => ({
    mintAddress: "MockMint456",
    name: "Renamed",
    symbol: "TEST",
    uri: "https://example.com/meta.json",
    transactionSignature: "MockUpdateSig789",
    explorerUrl:
      "https://explorer.solana.com/address/MockMint456?cluster=devnet",
  })),
  // Mirrors the real class so `instanceof` in the route resolves correctly.
  TokenUpdateError: class TokenUpdateError extends Error {
    constructor(
      public reason: string,
      message: string,
    ) {
      super(message);
      this.name = "TokenUpdateError";
    }
  },
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

/** Sends PATCH /token/:mint with a JSON body against a freshly mounted app. */
async function patch(
  body: unknown,
  headers: Record<string, string> = VALID_KEY,
  mint = "MockMint456",
) {
  const { default: tokenRoutes } = await import("../src/routes/token.ts");
  const app = new Hono().route("/", tokenRoutes);
  const res = await app.fetch(
    new Request(`http://localhost/token/${mint}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", ...headers },
      body: typeof body === "string" ? body : JSON.stringify(body),
    }),
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
    expect(body).toMatchObject({
      success: true,
      network: "devnet",
      mintAddress: "MockMint456",
      tokenAccountAddress: "MockTokenAccount789",
      metadataAddress: "MockMetadata012",
      initialSupply: "1,000,000",
      transactionSignature: "MockTxSignature345",
    });
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

describe("PATCH /token/:mint", () => {
  it("requires an API key", async () => {
    const { res } = await patch({ name: "New" }, {});

    expect(res.status).toBe(401);
  });

  it("updates the token and echoes the new values", async () => {
    const { updateTokenMetadata } = await import("../src/services/solana.ts");

    const { res, body } = await patch({ name: "Renamed" });

    expect(res.status).toBe(200);
    expect(body).toMatchObject({
      success: true,
      network: "devnet",
      mintAddress: "MockMint456",
      name: "Renamed",
      transactionSignature: "MockUpdateSig789",
    });
    expect(updateTokenMetadata).toHaveBeenCalledWith(
      expect.anything(),
      "MockMint456",
      { name: "Renamed" },
    );
  });

  it("forwards only the fields that were provided", async () => {
    const { updateTokenMetadata } = await import("../src/services/solana.ts");

    await patch({ symbol: "NEW", uri: "https://example.com/new.json" });

    expect(updateTokenMetadata).toHaveBeenCalledWith(
      expect.anything(),
      "MockMint456",
      { symbol: "NEW", uri: "https://example.com/new.json" },
    );
  });

  it("rejects a body without any known field", async () => {
    const { updateTokenMetadata } = await import("../src/services/solana.ts");

    const { res, body } = await patch({ decimals: 4 });

    expect(res.status).toBe(400);
    expect(body.error).toContain("at least one of");
    expect(updateTokenMetadata).not.toHaveBeenCalled();
  });

  it.each([
    ["an empty string", { name: "" }],
    ["a non-string", { symbol: 42 }],
  ])("rejects %s", async (_label, payload) => {
    const { res, body } = await patch(payload);

    expect(res.status).toBe(400);
    expect(body.success).toBe(false);
  });

  it("rejects a malformed JSON body", async () => {
    const { res, body } = await patch("{ not json");

    expect(res.status).toBe(400);
    expect(body.error).toContain("JSON");
  });

  it.each([
    ["not-found", 404],
    ["wrong-authority", 403],
    ["immutable", 409],
  ])("maps a %s refusal to HTTP %i", async (reason, status) => {
    const { updateTokenMetadata, TokenUpdateError } = await import(
      "../src/services/solana.ts"
    );
    vi.mocked(updateTokenMetadata).mockRejectedValueOnce(
      new TokenUpdateError(reason as never, `refused: ${reason}`),
    );

    const { res, body } = await patch({ name: "New" });

    expect(res.status).toBe(status);
    expect(body).toEqual({ success: false, error: `refused: ${reason}` });
  });

  it("maps an unexpected failure to a 500 response", async () => {
    const { updateTokenMetadata } = await import("../src/services/solana.ts");
    vi.mocked(updateTokenMetadata).mockRejectedValueOnce(
      new Error("RPC timeout"),
    );

    const { res, body } = await patch({ name: "New" });

    expect(res.status).toBe(500);
    expect(body).toEqual({ success: false, error: "RPC timeout" });
  });
});
