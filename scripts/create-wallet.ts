import { Keypair } from "@solana/web3.js";
import { writeFileSync } from "node:fs";

// Devnet only: generating a mainnet payer needs a proper secret manager.
const keypair = Keypair.generate();
const secretKeyBase64 = Buffer.from(keypair.secretKey).toString("base64");
const outPath = new URL("../.env", import.meta.url).pathname;

let envContent = "";
try {
  envContent = await Bun.file(outPath).text();
} catch {
  // no .env yet — start from scratch
}

const entry = `SOLANA_SECRET_KEY=${secretKeyBase64}`;
const next = envContent.match(/^SOLANA_SECRET_KEY=.*$/m)
  ? envContent.replace(/^SOLANA_SECRET_KEY=.*$/m, entry)
  : envContent.trimEnd() + `\n${entry}\n`;

writeFileSync(outPath, next);

console.log("Public key (payer address):", keypair.publicKey.toBase58());
console.log("Secret key written to .env as SOLANA_SECRET_KEY");
console.log(
  `\nFund the wallet once, then every request reuses it:\n  https://faucet.solana.com/?address=${keypair.publicKey.toBase58()}`,
);
