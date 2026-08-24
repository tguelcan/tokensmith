import { describe, expect, it, vi, beforeEach } from "vitest";
import { Keypair } from "@solana/web3.js";

const SOL = 1_000_000_000;

/** Builds a config mock; only network and secret key ever vary between tests. */
const { makeConfig } = vi.hoisted(() => ({
  makeConfig: (
    overrides: { network?: string; secretKeyBase64?: string } = {},
  ) => ({
    config: {
      solana: {
        network: overrides.network ?? "devnet",
        commitment: "confirmed",
        rpcUrl: null,
      },
      token: {
        name: "TestCoin",
        symbol: "TEST",
        decimals: 9,
        initialSupplyBaseUnits: 1000000n * 10n ** 9n,
        initialSupplyHumanReadable: "1,000,000",
        metadataUri: "https://example.com/metadata.json",
        isMutable: true,
        creatorShare: 100,
      },
      wallet: {
        secretKeyBase64: overrides.secretKeyBase64 ?? null,
        minBalanceLamports: 0.5 * 1_000_000_000,
        airdropAmountLamports: 1 * 1_000_000_000,
      },
    },
  }),
}));

const mockConnection = {
  getBalance: vi.fn(),
  requestAirdrop: vi.fn(),
  confirmTransaction: vi.fn(),
  rpcEndpoint: "https://api.devnet.solana.com",
};

const mockUmi = () => ({
  use: vi.fn().mockReturnThis(),
  eddsa: {
    createKeypairFromSecretKey: vi.fn(() => ({
      publicKey: "mock-public-key",
      secretKey: new Uint8Array(64),
    })),
  },
  identity: { publicKey: "mock-identity-public-key" },
});

vi.mock("../src/config.ts", () => makeConfig());

vi.mock("@solana/web3.js", async () => {
  const actual =
    await vi.importActual<typeof import("@solana/web3.js")>("@solana/web3.js");
  return {
    ...actual,
    Connection: vi.fn(function () {
      return mockConnection;
    }),
    clusterApiUrl: vi.fn().mockReturnValue("https://api.devnet.solana.com"),
  };
});

vi.mock("@metaplex-foundation/umi-bundle-defaults", () => ({
  createUmi: vi.fn(),
}));

vi.mock("@metaplex-foundation/umi", () => ({
  keypairIdentity: vi.fn(),
  percentAmount: vi.fn(() => 0),
  publicKey: vi.fn((value: string) => value),
  some: vi.fn((value: unknown) => value),
  generateSigner: vi.fn(() => ({
    publicKey: { toString: () => "MockMintAddress123" },
  })),
}));

vi.mock("@metaplex-foundation/umi/serializers", () => ({
  base58: { deserialize: vi.fn(() => ["mock-tx-signature", 64]) },
}));

vi.mock("@metaplex-foundation/umi-uploader-irys", () => ({
  irysUploader: vi.fn(),
}));

vi.mock("@metaplex-foundation/mpl-toolbox", () => ({
  // UMI returns PDAs as [address, bump] tuples.
  findAssociatedTokenPda: vi.fn(() => ["MockTokenAccount456", 252]),
}));

vi.mock("@metaplex-foundation/mpl-token-metadata", () => ({
  createAndMint: vi.fn(),
  fetchMetadata: vi.fn(),
  findMetadataPda: vi.fn(() => ["MockMetadata789", 255]),
  mplTokenMetadata: vi.fn(),
  updateV1: vi.fn(),
  TokenStandard: { Fungible: "Fungible" },
}));

/** Re-imports the service with a fresh config so overrides never leak between tests. */
async function importService(
  overrides?: Parameters<typeof makeConfig>[0],
): Promise<typeof import("../src/services/solana.ts")> {
  vi.doMock("../src/config.ts", () => makeConfig(overrides));
  vi.resetModules();
  return import("../src/services/solana.ts");
}

describe("loadPayer", () => {
  it("generates a new keypair when no secret key is configured", async () => {
    const { loadPayer } = await importService();

    expect(loadPayer().secretKey.length).toBe(64);
  });

  it("restores the configured keypair from its base64 secret key", async () => {
    const expected = Keypair.generate();
    const { loadPayer } = await importService({
      secretKeyBase64: Buffer.from(expected.secretKey).toString("base64"),
    });

    expect(loadPayer().publicKey.toBase58()).toBe(
      expected.publicKey.toBase58(),
    );
  });
});

describe("ensurePayerFunded", () => {
  beforeEach(() => {
    mockConnection.requestAirdrop.mockResolvedValue("airdrop-signature");
    mockConnection.confirmTransaction.mockResolvedValue({});
  });

  it("airdrops on devnet when the balance is below the threshold", async () => {
    mockConnection.getBalance.mockResolvedValue(0.1 * SOL);
    const { ensurePayerFunded } = await importService();
    const payer = Keypair.generate();

    await ensurePayerFunded(payer);

    expect(mockConnection.requestAirdrop).toHaveBeenCalledWith(
      payer.publicKey,
      1 * SOL,
    );
    expect(mockConnection.confirmTransaction).toHaveBeenCalledWith(
      "airdrop-signature",
      "confirmed",
    );
  });

  it("skips the airdrop when the balance is sufficient", async () => {
    mockConnection.getBalance.mockResolvedValue(1 * SOL);
    const { ensurePayerFunded } = await importService();

    await ensurePayerFunded(Keypair.generate());

    expect(mockConnection.requestAirdrop).not.toHaveBeenCalled();
  });

  it("points to the manual faucet when the devnet faucet rejects both attempts", async () => {
    vi.useFakeTimers();
    mockConnection.getBalance.mockResolvedValue(0.1 * SOL);
    mockConnection.requestAirdrop.mockRejectedValue(
      new Error("airdrop failed: Internal error"),
    );
    const { ensurePayerFunded } = await importService();
    const payer = Keypair.generate();

    const assertion = expect(ensurePayerFunded(payer)).rejects.toThrow(
      "faucet.solana.com",
    );
    await vi.runAllTimersAsync();
    await assertion;
    vi.useRealTimers();

    expect(mockConnection.requestAirdrop).toHaveBeenCalledTimes(2);
    expect(mockConnection.requestAirdrop).toHaveBeenLastCalledWith(
      payer.publicKey,
      0.5 * SOL,
    );
  });

  it("throws on mainnet instead of airdropping", async () => {
    mockConnection.getBalance.mockResolvedValue(0.1 * SOL);
    const { ensurePayerFunded } = await importService({
      network: "mainnet-beta",
    });

    await expect(ensurePayerFunded(Keypair.generate())).rejects.toThrow(
      "Insufficient balance on mainnet",
    );
    expect(mockConnection.requestAirdrop).not.toHaveBeenCalled();
  });
});

describe("createTokenWithSupply", () => {
  /** Wires up a successful createAndMint round-trip and returns the mocked builder. */
  async function mockSuccessfulMint() {
    const { createUmi } =
      await import("@metaplex-foundation/umi-bundle-defaults");
    const { createAndMint } =
      await import("@metaplex-foundation/mpl-token-metadata");

    vi.mocked(createUmi).mockReturnValue(mockUmi() as never);
    vi.mocked(createAndMint).mockReturnValue({
      sendAndConfirm: vi
        .fn()
        .mockResolvedValue({ signature: new Uint8Array(64) }),
    } as never);

    return createAndMint;
  }

  it("returns the mint, token account and metadata of the created token", async () => {
    await mockSuccessfulMint();
    const { createTokenWithSupply } = await importService();
    const payer = Keypair.generate();

    await expect(createTokenWithSupply(payer)).resolves.toEqual({
      payer: payer.publicKey.toBase58(),
      mintAddress: "MockMintAddress123",
      tokenAccountAddress: "MockTokenAccount456",
      metadataAddress: "MockMetadata789",
      name: "TestCoin",
      symbol: "TEST",
      initialSupply: "1,000,000",
      transactionSignature: "mock-tx-signature",
      explorerUrl:
        "https://explorer.solana.com/address/MockMintAddress123?cluster=devnet",
    });
  });

  it("mints the configured supply in the same transaction as the mint creation", async () => {
    const createAndMint = await mockSuccessfulMint();
    const { createTokenWithSupply } = await importService();

    await createTokenWithSupply(Keypair.generate());

    expect(createAndMint).toHaveBeenCalledTimes(1);
    expect(vi.mocked(createAndMint).mock.calls[0]?.[1]).toMatchObject({
      amount: 1000000n * 10n ** 9n,
      decimals: 9,
      name: "TestCoin",
      symbol: "TEST",
    });
  });

  it("passes the mint as a signer, not a bare address", async () => {
    const createAndMint = await mockSuccessfulMint();
    const { generateSigner } = await import("@metaplex-foundation/umi");
    const { createTokenWithSupply } = await importService();

    await createTokenWithSupply(Keypair.generate());

    // A bare address makes the metadata program reject the tx with 0x86.
    const { mint } = vi.mocked(createAndMint).mock.calls[0]![1];
    expect(mint).toBe(vi.mocked(generateSigner).mock.results[0]?.value);
    expect(typeof mint).toBe("object");
  });
});

describe("updateTokenMetadata", () => {
  const IDENTITY = "mock-identity-public-key";
  const MINT = "MockMintAddress123";

  /** Puts an existing token on chain, owned by the payer unless overridden. */
  async function mockExistingToken(
    overrides: { isMutable?: boolean; updateAuthority?: string } = {},
  ) {
    const { createUmi } = await import(
      "@metaplex-foundation/umi-bundle-defaults"
    );
    const { fetchMetadata, updateV1 } = await import(
      "@metaplex-foundation/mpl-token-metadata"
    );

    vi.mocked(createUmi).mockReturnValue(mockUmi() as never);
    vi.mocked(fetchMetadata).mockResolvedValue({
      name: "Old Name",
      symbol: "OLD",
      uri: "https://example.com/old.json",
      sellerFeeBasisPoints: 0,
      creators: [],
      isMutable: overrides.isMutable ?? true,
      updateAuthority: overrides.updateAuthority ?? IDENTITY,
    } as never);
    vi.mocked(updateV1).mockReturnValue({
      sendAndConfirm: vi
        .fn()
        .mockResolvedValue({ signature: new Uint8Array(64) }),
    } as never);

    return updateV1;
  }

  it("changes only the provided fields and keeps the rest", async () => {
    const updateV1 = await mockExistingToken();
    const { updateTokenMetadata } = await importService();

    const result = await updateTokenMetadata(Keypair.generate(), MINT, {
      name: "New Name",
    });

    expect(result).toEqual({
      mintAddress: MINT,
      name: "New Name",
      symbol: "OLD",
      uri: "https://example.com/old.json",
      transactionSignature: "mock-tx-signature",
      explorerUrl: `https://explorer.solana.com/address/${MINT}?cluster=devnet`,
    });
    expect(vi.mocked(updateV1).mock.calls[0]?.[1]).toMatchObject({
      data: { name: "New Name", symbol: "OLD" },
    });
  });

  it("refuses a frozen token without sending a transaction", async () => {
    const updateV1 = await mockExistingToken({ isMutable: false });
    const { updateTokenMetadata, TokenUpdateError } = await importService();

    const failure = await updateTokenMetadata(Keypair.generate(), MINT, {
      name: "New Name",
    }).catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(TokenUpdateError);
    expect((failure as InstanceType<typeof TokenUpdateError>).reason).toBe(
      "immutable",
    );
    expect(updateV1).not.toHaveBeenCalled();
  });

  it("refuses when the payer is not the update authority", async () => {
    const updateV1 = await mockExistingToken({
      updateAuthority: "someone-else",
    });
    const { updateTokenMetadata, TokenUpdateError } = await importService();

    const failure = await updateTokenMetadata(Keypair.generate(), MINT, {
      symbol: "NEW",
    }).catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(TokenUpdateError);
    expect((failure as InstanceType<typeof TokenUpdateError>).reason).toBe(
      "wrong-authority",
    );
    expect(updateV1).not.toHaveBeenCalled();
  });

  it("reports a missing token as not-found", async () => {
    const { createUmi } = await import(
      "@metaplex-foundation/umi-bundle-defaults"
    );
    const { fetchMetadata } = await import(
      "@metaplex-foundation/mpl-token-metadata"
    );
    vi.mocked(createUmi).mockReturnValue(mockUmi() as never);
    vi.mocked(fetchMetadata).mockRejectedValue(new Error("Account not found"));

    const { updateTokenMetadata, TokenUpdateError } = await importService();

    const failure = await updateTokenMetadata(Keypair.generate(), MINT, {
      name: "New Name",
    }).catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(TokenUpdateError);
    expect((failure as InstanceType<typeof TokenUpdateError>).reason).toBe(
      "not-found",
    );
  });
});
