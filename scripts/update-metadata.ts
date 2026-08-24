import {
  TokenUpdateError,
  loadPayer,
  updateTokenMetadata,
  type MetadataChanges,
} from "../src/services/solana.ts";
import { config } from "../src/config.ts";

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

const changes: MetadataChanges = {};
for (let i = 0; i < rest.length; i += 2) {
  const key = rest[i];
  const value = rest[i + 1];
  if (!key?.startsWith("--") || value === undefined) {
    console.error(`Malformed option near "${key}"`);
    process.exit(1);
  }
  const field = key.slice(2);
  if (field !== "name" && field !== "symbol" && field !== "uri") {
    console.error(`Unknown option "--${field}"`);
    process.exit(1);
  }
  changes[field] = value;
}

if (Object.keys(changes).length === 0) {
  console.error(
    "Nothing to change — pass at least one of --name, --symbol, --uri.",
  );
  process.exit(1);
}

if (!config.wallet.secretKeyBase64) {
  console.error(
    "No SOLANA_SECRET_KEY configured. Only the wallet that created the token can update it.",
  );
  process.exit(1);
}

try {
  const updated = await updateTokenMetadata(loadPayer(), mintAddress, changes);

  console.log("Updated on-chain metadata");
  console.log("  name  :", updated.name);
  console.log("  symbol:", updated.symbol);
  console.log("  uri   :", updated.uri);
  console.log(
    `\nDone. Wallets may cache the old values for a while.\n${updated.explorerUrl}`,
  );
} catch (error) {
  console.error(
    error instanceof TokenUpdateError
      ? `Refused (${error.reason}): ${error.message}`
      : error instanceof Error
        ? error.message
        : error,
  );
  process.exit(1);
}
