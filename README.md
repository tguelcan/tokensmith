<div align="center">

<img src="metadata/demo-token.png" alt="TokenSmith" width="120" height="120">

# TokenSmith

**Self-hostable API for minting SPL tokens on Solana — name, symbol and logo included.**

One HTTP request creates the mint, attaches Metaplex metadata and mints the initial supply, all in a single atomic transaction.

[![CI](https://github.com/tguelcan/tokensmith/actions/workflows/ci.yml/badge.svg)](https://github.com/tguelcan/tokensmith/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Bun](https://img.shields.io/badge/Bun-1.2+-000?logo=bun&logoColor=white)](https://bun.sh)
[![TypeScript](https://img.shields.io/badge/TypeScript-5-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Solana](https://img.shields.io/badge/Solana-devnet%20%7C%20mainnet-14F195?logo=solana&logoColor=white)](https://solana.com)
[![PRs welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](https://github.com/tguelcan/tokensmith/pulls)

</div>

---

## Quick Start

Get a real token on Solana devnet in about two minutes.

### 1. Install

```bash
git clone https://github.com/tguelcan/tokensmith.git
cd tokensmith
bun install
```

### 2. Create and fund a wallet

```bash
bun run wallet
```

This writes a `SOLANA_SECRET_KEY` into `.env` and prints a faucet link. **Open the link and request SOL once.**

> Skipping this works, but then every request generates a throwaway wallet with 0 SOL and depends on the public faucet — which rate-limits after a few calls (HTTP 429).

### 3. Start the server

```bash
bun run dev
```

### 4. Mint a token

```bash
curl -X POST http://localhost:3000/create-token \
  -H "X-API-Key: dev-api-key-12345"
```

```json
{
  "success": true,
  "network": "devnet",
  "mintAddress": "8xopdJrcbbMY21r6dyghxjX9tKEmTNpgVefTWGgzk5hG",
  "tokenAccountAddress": "HErevoYbc1cpUwrdq3KFJ8LbthTezRiEWiKVRoM3S5Z7",
  "metadataAddress": "4ywAmWZUkY3WbGXYsAT3sN3kUmMZ5DtFqyLrwfu38QXy",
  "name": "TokenSmith Demo",
  "symbol": "SMITH",
  "initialSupply": "1,000,000",
  "explorerUrl": "https://explorer.solana.com/address/8xop...?cluster=devnet"
}
```

Open `explorerUrl` to see your token on-chain.

> **Why is the logo missing?** The default `token.metadataUri` points at a placeholder URL that does not exist yet. See [Give your token a name and logo](#give-your-token-a-name-and-logo).

---

## Give your token a name and logo

Token metadata lives in **two** places, and knowing which is which explains what you can change later:

| Layer         | Contains                             | Stored         | Changing it         |
| ------------- | ------------------------------------ | -------------- | ------------------- |
| **On-chain**  | `name`, `symbol`, `uri`, `isMutable` | Solana account | Needs a transaction |
| **Off-chain** | `description`, `image`, `attributes` | JSON at `uri`  | Just edit the file  |

### Set it up

1. Edit [`metadata/demo-token.json`](metadata/demo-token.json) and replace `metadata/demo-token.png` with your own logo (512×512 PNG recommended — SVG is not rendered by all wallets).
2. Push to GitHub. The raw URL becomes your `metadataUri`:
   ```
   https://raw.githubusercontent.com/tguelcan/tokensmith/main/metadata/demo-token.json
   ```
3. Put that URL into `config.json` → `token.metadataUri`, and set `token.name` / `token.symbol`.

For production, prefer permanent storage ([Arweave](https://arweave.org), [IPFS](https://ipfs.tech)) over a mutable GitHub branch.

### Changing a token that already exists

**Swapping the logo or description costs nothing and needs no transaction.** The on-chain record only stores the _URL_. Update the JSON (or the image it points to) at the same URL and wallets pick it up on their next refresh — caching means this can take minutes to hours.

**Changing `name`, `symbol` or the `uri` itself requires an on-chain update** via the Metaplex `updateV1` instruction. Two conditions must hold:

- The token was created with `isMutable: true` (the default here)
- You hold the update authority — the payer wallet that created it

> Set `isMutable: false` and the on-chain fields are frozen **permanently**. That is a feature — it is what lets holders trust that a token cannot be renamed after the fact — but it is irreversible.

TokenSmith does not expose an update endpoint yet; only creation is implemented. Contributions welcome.

---

## Configuration

Defaults live in [`config.json`](config.json). Environment variables always win, so secrets never need to touch the file.

| Key                       | Description                          | Default             |
| ------------------------- | ------------------------------------ | ------------------- |
| `server.port`             | HTTP port                            | `3000`              |
| `server.apiKey`           | API key clients must send            | `dev-api-key-12345` |
| `solana.network`          | `devnet` or `mainnet-beta`           | `devnet`            |
| `solana.commitment`       | Commitment level                     | `confirmed`         |
| `solana.rpcUrl`           | Custom RPC (`null` = public cluster) | `null`              |
| `token.name`              | Token name                           | `TokenSmith Demo`   |
| `token.symbol`            | Token ticker                         | `SMITH`             |
| `token.decimals`          | Decimal places                       | `9`                 |
| `token.initialSupply`     | Tokens minted per request            | `1000000`           |
| `token.metadataUri`       | URL of the off-chain JSON            | see config          |
| `token.isMutable`         | Whether metadata stays changeable    | `true`              |
| `token.creatorShare`      | Creator share, 0–100                 | `100`               |
| `wallet.minBalanceSol`    | Balance below which SOL is topped up | `0.5`               |
| `wallet.airdropAmountSol` | Airdrop size (devnet only)           | `1`                 |
| `wallet.secretKeyEnv`     | Env var holding the secret key       | `SOLANA_SECRET_KEY` |

### Environment variables

Copy [`.env.example`](.env.example) to `.env` — Bun loads it automatically.

| Variable            | Overrides       | Required for   |
| ------------------- | --------------- | -------------- |
| `PORT`              | `server.port`   | —              |
| `API_KEY`           | `server.apiKey` | **Production** |
| `SOLANA_RPC_URL`    | `solana.rpcUrl` | Mainnet        |
| `SOLANA_SECRET_KEY` | —               | **Production** |

---

## API

All endpoints require an API key, sent either way:

```
X-API-Key: your-api-key
Authorization: Bearer your-api-key
```

### `POST /create-token`

Creates the mint, attaches metadata, creates the associated token account and mints the initial supply — in **one atomic transaction**, so a failure never leaves a half-created token behind.

| Status | Meaning                                                      |
| ------ | ------------------------------------------------------------ |
| `200`  | Token created; body contains all addresses and `explorerUrl` |
| `401`  | No API key provided                                          |
| `403`  | API key invalid                                              |
| `500`  | Creation failed; `error` explains why                        |

---

## Going to mainnet

Everything above runs on devnet with free SOL. For real tokens:

**1. Get a reliable RPC.** Public mainnet endpoints are rate-limited and unreliable. [Helius](https://helius.dev) has a free tier:

```bash
export SOLANA_RPC_URL="https://mainnet.helius-rpc.com/?api-key=YOUR-KEY"
```

Verify it responds:

```bash
curl -s -X POST "$SOLANA_RPC_URL" -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"getHealth"}'
# {"jsonrpc":"2.0","result":"ok","id":1}
```

**2. Fund a dedicated wallet** with 0.1–0.5 SOL. Do not reuse a personal wallet.

**3. Switch the network** in `config.json`:

```json
{ "solana": { "network": "mainnet-beta" } }
```

**4. Set real secrets** as environment variables:

```bash
export API_KEY="$(openssl rand -hex 32)"
export SOLANA_SECRET_KEY="<base64 secret key>"
```

### Before you ship

- [ ] `metadataUri` points at permanent storage, not a GitHub branch you might rewrite
- [ ] `token.name` and `token.symbol` are final, or `isMutable` stays `true`
- [ ] API is behind HTTPS — the API key is a bearer credential
- [ ] Secrets come from a secret manager (AWS/GCP Secrets Manager, Vault), not a file
- [ ] Rate limiting in front of the API — it spends real SOL on every call

> On mainnet there are no airdrops. If the wallet runs dry, requests fail with a clear error instead of silently topping up.

---

## Security

- **Never commit `.env` or wallet files.** `.gitignore` covers `.env`; double-check before your first push.
- **The payer wallet is a hot wallet.** Whoever holds `SOLANA_SECRET_KEY` controls every token it created and can mint more. Keep only what you need for fees on it.
- **Rotate the API key** by changing `API_KEY` and restarting — no code change needed.
- **Consider revoking the mint authority** after the initial supply if you want holders to trust that no more tokens can appear. Not implemented yet.

---

## Development

```bash
bun run dev         # watch mode
bun run test        # run tests once
bun run test:watch  # watch mode
bunx tsc --noEmit   # typecheck
```

All blockchain calls are mocked, so the suite runs offline in well under a second. CI runs tests, typecheck and metadata validation on every push and PR.

```
config.json           # defaults for server, Solana, token, wallet
metadata/             # off-chain token metadata + demo icon
scripts/
  create-wallet.ts    # generates a reusable payer wallet into .env
src/
  index.ts            # entry point, mounts routes
  config.ts           # typed config loader (config.json + env)
  middleware/auth.ts  # API key authentication
  routes/token.ts     # POST /create-token
  services/solana.ts  # wallet, funding, Metaplex token creation
tests/                # config, service and API tests (mocked)
```

Deeper technical background, design decisions and troubleshooting live in [PROJECT_KNOWLEDGE.md](PROJECT_KNOWLEDGE.md). Conventions for AI assistants are in [AGENTS.md](AGENTS.md).

---

## License

[MIT](LICENSE)
