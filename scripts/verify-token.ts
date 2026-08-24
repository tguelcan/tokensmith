import { createUmi } from "@metaplex-foundation/umi-bundle-defaults";
import {
  fetchMetadata,
  findMetadataPda,
  mplTokenMetadata,
} from "@metaplex-foundation/mpl-token-metadata";
import { publicKey } from "@metaplex-foundation/umi";
import { clusterApiUrl } from "@solana/web3.js";
import { config } from "../src/config.ts";

const mintAddress = process.argv[2];

if (!mintAddress) {
  console.error("Usage: bun run verify <MINT_ADDRESS>");
  process.exit(1);
}

const endpoint = config.solana.rpcUrl ?? clusterApiUrl(config.solana.network);
const umi = createUmi(endpoint).use(mplTokenMetadata());
const [metadataPda] = findMetadataPda(umi, { mint: publicKey(mintAddress) });

const onChain = await fetchMetadata(umi, metadataPda);

console.log("On-chain metadata");
console.log("  name      :", onChain.name);
console.log("  symbol    :", onChain.symbol);
console.log("  uri       :", onChain.uri);
console.log("  isMutable :", onChain.isMutable);

const uriResponse = await fetch(onChain.uri);
console.log("\nOff-chain JSON");
console.log("  status    :", uriResponse.status, uriResponse.statusText);

if (!uriResponse.ok) {
  console.error(
    "\n  The metadata URI is unreachable — wallets will show no logo.",
  );
  process.exit(1);
}

const json = (await uriResponse.json()) as { name?: string; image?: string };
console.log("  name      :", json.name);
console.log("  image     :", json.image);

if (!json.image) {
  console.error("\n  No image field — wallets will show no logo.");
  process.exit(1);
}

const image = await fetch(json.image, { method: "HEAD" });
console.log("\nImage");
console.log("  status    :", image.status, image.statusText);
console.log("  type      :", image.headers.get("content-type"));

const explorer = `https://explorer.solana.com/address/${mintAddress}${
  config.solana.network === "mainnet-beta"
    ? ""
    : `?cluster=${config.solana.network}`
}`;
console.log(`\n${image.ok ? "All good." : "Image unreachable."} ${explorer}`);
