import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

describe("Config", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.resetModules();
    // Start from a clean slate: a developer's .env must not decide test outcomes.
    process.env = { ...originalEnv };
    delete process.env.PORT;
    delete process.env.API_KEY;
    delete process.env.SOLANA_RPC_URL;
    delete process.env.SOLANA_SECRET_KEY;
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it("should load default values from config.json", async () => {
    const { config } = await import("../src/config.ts");

    expect(config.server.port).toBe(3000);
    expect(config.solana.network).toBe("devnet");
    expect(config.solana.commitment).toBe("confirmed");
    expect(config.token.name).toBe("TokenSmith Demo");
    expect(config.token.symbol).toBe("SMITH");
    expect(config.token.decimals).toBe(9);
    expect(config.wallet.minBalanceLamports).toBe(0.5 * 1_000_000_000);
    expect(config.wallet.airdropAmountLamports).toBe(1 * 1_000_000_000);
  });

  it("should convert initial supply to base units correctly", async () => {
    const { config } = await import("../src/config.ts");

    // 1,000,000 tokens with 9 decimals = 1e15 base units
    expect(config.token.initialSupplyBaseUnits).toBe(1000000n * 10n ** 9n);
  });

  it("should use PORT env variable when set", async () => {
    process.env.PORT = "8080";
    const { config } = await import("../src/config.ts");

    expect(config.server.port).toBe(8080);
  });

  it("should use SOLANA_RPC_URL env variable when set", async () => {
    process.env.SOLANA_RPC_URL = "https://custom-rpc.example.com";
    const { config } = await import("../src/config.ts");

    expect(config.solana.rpcUrl).toBe("https://custom-rpc.example.com");
  });

  it("should use SOLANA_SECRET_KEY env variable when set", async () => {
    process.env.SOLANA_SECRET_KEY = "dGVzdC1zZWNyZXQta2V5"; // base64 "test-secret-key"
    const { config } = await import("../src/config.ts");

    expect(config.wallet.secretKeyBase64).toBe("dGVzdC1zZWNyZXQta2V5");
  });

  it("should return null for secret key when env is not set", async () => {
    delete process.env.SOLANA_SECRET_KEY;
    const { config } = await import("../src/config.ts");

    expect(config.wallet.secretKeyBase64).toBeNull();
  });
});
