import { Connection, Keypair, clusterApiUrl, PublicKey } from "@solana/web3.js";
import { createUmi } from "@metaplex-foundation/umi-bundle-defaults";
import {
  createAndMint,
  fetchMetadata,
  findMetadataPda,
  mplTokenMetadata,
  TokenStandard,
  updateV1,
} from "@metaplex-foundation/mpl-token-metadata";
import { findAssociatedTokenPda } from "@metaplex-foundation/mpl-toolbox";
import {
  generateSigner,
  keypairIdentity,
  percentAmount,
  publicKey,
  some,
} from "@metaplex-foundation/umi";
import { base58 } from "@metaplex-foundation/umi/serializers";
import { irysUploader } from "@metaplex-foundation/umi-uploader-irys";
import { config } from "../config.ts";

/**
 * Shared connection to the configured Solana cluster.
 * Uses custom RPC if provided, otherwise falls back to public cluster URL.
 */
export const connection = new Connection(
  config.solana.rpcUrl ?? clusterApiUrl(config.solana.network),
  config.solana.commitment,
);

/**
 * Result of a freshly created SPL token with metadata.
 */
export interface CreatedToken {
  payer: string;
  mintAddress: string;
  tokenAccountAddress: string;
  metadataAddress: string;
  name: string;
  symbol: string;
  initialSupply: string;
  transactionSignature: string;
  explorerUrl: string;
}

/**
 * On-chain fields that can be changed after creation.
 * The image and description live in the JSON behind `uri` and need no transaction.
 */
export interface MetadataChanges {
  name?: string;
  symbol?: string;
  uri?: string;
}

export interface UpdatedToken {
  mintAddress: string;
  name: string;
  symbol: string;
  uri: string;
  transactionSignature: string;
  explorerUrl: string;
}

export type UpdateFailure = "not-found" | "immutable" | "wrong-authority";

/** Carries why an update was refused so callers can map it to a status code. */
export class TokenUpdateError extends Error {
  constructor(
    readonly reason: UpdateFailure,
    message: string,
  ) {
    super(message);
    this.name = "TokenUpdateError";
  }
}

/** Explorer omits the cluster query only on mainnet. */
export function explorerUrl(address: string): string {
  const suffix =
    config.solana.network === "mainnet-beta"
      ? ""
      : `?cluster=${config.solana.network}`;
  return `https://explorer.solana.com/address/${address}${suffix}`;
}

/**
 * Loads the server-side payer wallet.
 * Uses the configured secret key when provided, otherwise generates a new keypair.
 */
export function loadPayer(): Keypair {
  if (config.wallet.secretKeyBase64) {
    return Keypair.fromSecretKey(
      Buffer.from(config.wallet.secretKeyBase64, "base64"),
    );
  }
  return Keypair.generate();
}

/**
 * Ensures the payer wallet holds enough SOL for transaction fees.
 * Only requests airdrops on devnet/testnet — on mainnet this throws if underfunded.
 */
export async function ensurePayerFunded(payer: Keypair): Promise<void> {
  const balance = await connection.getBalance(payer.publicKey);
  const network = config.solana.network;

  if (balance < config.wallet.minBalanceLamports) {
    if (network === "mainnet-beta") {
      throw new Error(
        `Insufficient balance on mainnet. Required: ${config.wallet.minBalanceLamports / 1e9} SOL, Available: ${balance / 1e9} SOL`,
      );
    }

    const signature = await requestAirdropWithRetry(
      payer.publicKey,
      config.wallet.airdropAmountLamports,
    );
    await connection.confirmTransaction(signature, "confirmed");
  }
}

/** The public devnet faucet rate-limits and often rejects larger amounts; retry once with half. */
async function requestAirdropWithRetry(
  publicKey: PublicKey,
  lamports: number,
): Promise<string> {
  try {
    return await connection.requestAirdrop(publicKey, lamports);
  } catch (error) {
    console.warn(
      `Airdrop of ${lamports / 1e9} SOL failed, retrying with half in 2s:`,
      error instanceof Error ? error.message : error,
    );
    await new Promise((resolve) => setTimeout(resolve, 2_000));
    try {
      return await connection.requestAirdrop(
        publicKey,
        Math.floor(lamports / 2),
      );
    } catch (retryError) {
      throw new Error(
        `Devnet faucet unavailable for ${publicKey.toBase58()}. ` +
          `Fund the wallet manually at https://faucet.solana.com and retry. ` +
          `(${retryError instanceof Error ? retryError.message : "unknown faucet error"})`,
      );
    }
  }
}

/**
 * Builds a UMI client that signs as the given payer.
 * Not cached: the payer differs per request when no secret key is configured.
 */
function createUmiFor(payer: Keypair) {
  const umi = createUmi(connection.rpcEndpoint)
    .use(mplTokenMetadata())
    .use(irysUploader());

  return umi.use(
    keypairIdentity(umi.eddsa.createKeypairFromSecretKey(payer.secretKey)),
  );
}

/**
 * Creates a new SPL token with Metaplex metadata and mints the initial supply
 * to the payer's associated token account — all in a single transaction.
 */
export async function createTokenWithSupply(
  payer: Keypair,
): Promise<CreatedToken> {
  const umi = createUmiFor(payer);
  const mint = generateSigner(umi);
  const mintAddress = mint.publicKey.toString();

  const { signature } = await createAndMint(umi, {
    mint,
    authority: umi.identity,
    name: config.token.name,
    symbol: config.token.symbol,
    uri: config.token.metadataUri,
    sellerFeeBasisPoints: percentAmount(0),
    tokenStandard: TokenStandard.Fungible,
    isMutable: config.token.isMutable,
    creators: [
      {
        address: umi.identity.publicKey,
        verified: true,
        share: config.token.creatorShare,
      },
    ],
    decimals: config.token.decimals,
    amount: config.token.initialSupplyBaseUnits,
    tokenOwner: umi.identity.publicKey,
  }).sendAndConfirm(umi);

  const [transactionSignature] = base58.deserialize(signature);
  // UMI PDAs are [address, bump] tuples — take the address only.
  const [metadataAddress] = findMetadataPda(umi, { mint: mint.publicKey });
  const [tokenAccountAddress] = findAssociatedTokenPda(umi, {
    mint: mint.publicKey,
    owner: umi.identity.publicKey,
  });

  return {
    payer: payer.publicKey.toBase58(),
    mintAddress,
    tokenAccountAddress,
    metadataAddress,
    name: config.token.name,
    symbol: config.token.symbol,
    initialSupply: config.token.initialSupplyHumanReadable,
    transactionSignature,
    explorerUrl: explorerUrl(mintAddress),
  };
}

/**
 * Changes the on-chain name, symbol or URI of an existing token.
 * Refuses before sending when the metadata is frozen or the payer is not the
 * update authority, so the caller gets a clear reason instead of a program error.
 */
export async function updateTokenMetadata(
  payer: Keypair,
  mintAddress: string,
  changes: MetadataChanges,
): Promise<UpdatedToken> {
  const umi = createUmiFor(payer);
  const mint = publicKey(mintAddress);
  const [metadataPda] = findMetadataPda(umi, { mint });

  let current: Awaited<ReturnType<typeof fetchMetadata>>;
  try {
    current = await fetchMetadata(umi, metadataPda);
  } catch {
    throw new TokenUpdateError(
      "not-found",
      `No Metaplex metadata found for mint ${mintAddress}.`,
    );
  }

  if (!current.isMutable) {
    throw new TokenUpdateError(
      "immutable",
      "This token was created with isMutable: false — its metadata is frozen permanently.",
    );
  }

  if (current.updateAuthority !== umi.identity.publicKey) {
    throw new TokenUpdateError(
      "wrong-authority",
      `Update authority mismatch: token expects ${current.updateAuthority}, wallet is ${umi.identity.publicKey}.`,
    );
  }

  const next = {
    name: changes.name ?? current.name,
    symbol: changes.symbol ?? current.symbol,
    uri: changes.uri ?? current.uri,
    sellerFeeBasisPoints: current.sellerFeeBasisPoints,
    creators: current.creators,
  };

  const { signature } = await updateV1(umi, {
    mint,
    authority: umi.identity,
    data: some(next),
  }).sendAndConfirm(umi);

  const [transactionSignature] = base58.deserialize(signature);

  return {
    mintAddress,
    name: next.name,
    symbol: next.symbol,
    uri: next.uri,
    transactionSignature,
    explorerUrl: explorerUrl(mintAddress),
  };
}
