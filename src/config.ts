import type { Cluster, Commitment } from "@solana/web3.js";
import configJson from "../config.json";

/**
 * Application configuration, loaded from config.json.
 * Environment variables take precedence over file values where applicable.
 */
export const config = {
  server: {
    port: Number(process.env.PORT ?? configJson.server.port),
    /** API key for authentication; falls back to config.json value if env not set. */
    apiKey: process.env.API_KEY ?? configJson.server.apiKey,
  },
  solana: {
    network: configJson.solana.network as Cluster,
    commitment: configJson.solana.commitment as Commitment,
    /** Custom RPC endpoint; falls back to public clusterApiUrl if null. */
    rpcUrl: process.env.SOLANA_RPC_URL ?? configJson.solana.rpcUrl ?? null,
  },
  token: {
    name: configJson.token.name,
    symbol: configJson.token.symbol,
    decimals: configJson.token.decimals,
    /** Total initial supply expressed in base units (smallest denomination). */
    initialSupplyBaseUnits:
      BigInt(configJson.token.initialSupply) *
      10n ** BigInt(configJson.token.decimals),
    initialSupplyHumanReadable:
      configJson.token.initialSupply.toLocaleString("en-US"),
    metadataUri: configJson.token.metadataUri,
    isMutable: configJson.token.isMutable,
    creatorShare: configJson.token.creatorShare,
  },
  wallet: {
    /** Secret key as base64 string; falls back to a freshly generated keypair if unset. */
    secretKeyBase64: process.env[configJson.wallet.secretKeyEnv] ?? null,
    minBalanceLamports: configJson.wallet.minBalanceSol * 1_000_000_000,
    airdropAmountLamports: configJson.wallet.airdropAmountSol * 1_000_000_000,
  },
} as const;
