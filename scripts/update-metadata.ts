import { createUmi } from "@metaplex-foundation/umi-bundle-defaults";
import {
  fetchMetadata,
  findMetadataPda,
  mplTokenMetadata,
  updateV1,
} from "@metaplex-foundation/mpl-token-metadata";
import { keypairIdentity, publicKey, some } from "@metaplex-foundation/umi";
import { clusterApiUrl } from "@solana/web3.js";
import { config } from "../src/config.ts";
import { loadPayer } from "../src/services/solana.ts";

const [mintAddress, ...rest] = process.argv.slice(2);

if (!mintAddress) {
  console.error(`Usage: bun run update <MINT_ADDRESS> [options]

  --name <text>     new on-chain name
  --symbol <text>   new on-chain symbol
  --uri <url>       new metadata URI

Only the on-chain record changes. Editing the JSON behind an unchanged
URI needs no transaction at all.`);
  process.exit(1);
}

const flags = new Map<string, string>();
for (let i = 0; i < rest.length; i += 2) {
  const key = rest[i];
  const value = rest[i + 1];
  if (!key?.startsWith("--") || value === undefined) {
    console.error(`Malformed option near "${key}"`);
    process.exit(1);
  }
  flags.set(key.slice(2), value);
}

if (flags.size === 0) {
  console.error(
    "Nothing to change — pass at least one of --name, --symbol, --uri.",
  );
  process.exit(1);
}

const payer = loadPayer();
if (!config.wallet.secretKeyBase64) {
  console.error(
    "No SOLANA_SECRET_KEY configured. Only the wallet that created the token can update it.",
  );
  process.exit(1);
}

const endpoint = config.solana.rpcUrl ?? clusterApiUrl(config.solana.network);
const umi = createUmi(endpoint).use(mplTokenMetadata());
umi.use(keypairIdentity(umi.eddsa.createKeypairFromSecretKey(payer.secretKey)));

const mint = publicKey(mintAddress);
const [metadataPda] = findMetadataPda(umi, { mint });
const current = await fetchMetadata(umi, metadataPda);

if (!current.isMutable) {
  console.error(
    "This token was created with isMutable: false — its metadata is frozen permanently.",
  );
  process.exit(1);
}

if (current.updateAuthority !== umi.identity.publicKey) {
  console.error(
    `Update authority mismatch.\n  token expects : ${current.updateAuthority}\n  wallet is     : ${umi.identity.publicKey}`,
  );
  process.exit(1);
}

const next = {
  name: flags.get("name") ?? current.name,
  symbol: flags.get("symbol") ?? current.symbol,
  uri: flags.get("uri") ?? current.uri,
  sellerFeeBasisPoints: current.sellerFeeBasisPoints,
  creators: current.creators,
};

console.log("Updating on-chain metadata");
for (const field of ["name", "symbol", "uri"] as const) {
  const marker = current[field] === next[field] ? " " : "*";
  console.log(
    ` ${marker} ${field.padEnd(7)}: ${current[field]} -> ${next[field]}`,
  );
}

await updateV1(umi, {
  mint,
  authority: umi.identity,
  data: some(next),
}).sendAndConfirm(umi);

const explorer = `https://explorer.solana.com/address/${mintAddress}${
  config.solana.network === "mainnet-beta"
    ? ""
    : `?cluster=${config.solana.network}`
}`;
console.log(
  `\nDone. Wallets may cache the old values for a while.\n${explorer}`,
);
