# Project Knowledge Base

This document contains all essential information about this project for AI assistants and new developers. It should be kept up-to-date as the project evolves.

---

## Project Overview

**Name**: TokenSmith  
**Purpose**: A Hono-based API (running on Bun) that creates SPL tokens with Metaplex metadata on Solana  
**Status**: Production-ready for Mainnet (with proper configuration)  
**Created**: August 2026

---

## Architecture

### High-Level Structure

```
tokensmith/
├── config.json              # Central configuration (server, Solana, token, wallet)
├── .env.example             # Template for local env overrides (.env is gitignored)
├── metadata/
│   ├── demo-token.json     # Example token metadata (name, symbol, logo)
│   ├── demo-token.png      # Demo icon served to wallets and explorers
│   └── demo-token.svg      # Vector source of the icon
├── scripts/
│   └── create-wallet.ts     # Generates a reusable payer wallet into .env
├── src/
│   ├── index.ts             # Entry point: mounts routes, starts server
│   ├── config.ts            # Typed config loader with env overrides
│   ├── middleware/
│   │   └── auth.ts          # API key authentication middleware
│   ├── routes/
│   │   └── token.ts         # POST /create-token endpoint
│   └── services/
│       └── solana.ts        # Solana operations: wallet, funding, token creation
├── tests/
│   ├── config.test.ts       # Config loading and validation tests
│   ├── solana.test.ts       # Solana service logic tests (mocked)
│   └── api.test.ts          # API endpoint and auth tests
├── vitest.config.ts         # Test configuration
└── package.json             # Bun scripts and dependencies
```

### Key Design Decisions

1. **Separation of Concerns**: Routes → Services → Config. Each layer has a single responsibility.
2. **Environment-based Config**: `config.json` for defaults, environment variables for overrides (12-factor app).
3. **Hono Blueprint Pattern**: Routes are modular and can be mounted/unmounted easily.
4. **Mock-based Testing**: All blockchain calls are mocked in tests for speed and reliability.
5. **Single-transaction token creation**: `createAndMint` is used instead of a separate
   `createMint` + `createV1`. The metadata program requires the mint account to sign
   when it does not yet exist, so a pre-created mint fails with `0x86`.

---

## Technology Stack

| Component      | Technology       | Version | Purpose                                |
| -------------- | ---------------- | ------- | -------------------------------------- |
| Runtime        | Bun              | 1.2.14+ | JavaScript runtime and package manager |
| Framework      | Hono             | 4.13.3+ | Lightweight web framework              |
| Blockchain     | Solana Web3.js   | 1.98.4+ | Connection, keypairs, airdrops         |
| Token/Metadata | Metaplex UMI     | 1.5.1+  | Mint creation, metadata, minting       |
| PDA helpers    | Metaplex Toolbox | 0.11.4+ | Associated token account derivation    |
| Testing        | Vitest           | 4.1.11+ | Unit and integration testing           |

> `@solana/spl-token` is intentionally **not** a dependency. Token creation runs
> entirely through Metaplex `createAndMint` (see Key Design Decisions).

---

## Core Functionality

### What the API Does

A single `createAndMint` call bundles the following into **one atomic transaction**:

1. **Creates the SPL token mint** with the configured decimals
2. **Attaches Metaplex metadata** — name, symbol, and off-chain metadata URI
3. **Creates the associated token account** for the payer
4. **Mints the initial supply** into that account

The response then returns the mint, token account and metadata addresses plus a
Solana Explorer link for verification. Because the transaction is atomic, a
failure leaves no partially created token behind.

### API Endpoints

| Method | Endpoint        | Auth Required | Description                           |
| ------ | --------------- | ------------- | ------------------------------------- |
| POST   | `/create-token` | Yes (API Key) | Creates a new SPL token with metadata |

### Authentication

- **Method**: API Key via `X-API-Key` header or `Authorization: Bearer` token
- **Config**: `config.json` → `server.apiKey` or env var `API_KEY`
- **Default (Dev)**: `dev-api-key-12345`

---

## Configuration Reference

### config.json Structure

```json
{
  "server": {
    "port": 3000, // HTTP port
    "apiKey": "dev-api-key-12345" // API key for authentication
  },
  "solana": {
    "network": "devnet", // "devnet" or "mainnet-beta"
    "commitment": "confirmed", // Transaction commitment level
    "rpcUrl": null // Custom RPC (null = public cluster)
  },
  "token": {
    "name": "TokenSmith Demo", // Token display name
    "symbol": "SMITH", // Token ticker
    "decimals": 9, // Decimal places
    "initialSupply": 1000000, // Tokens to mint on creation
    "metadataUri": "https://...", // URL to off-chain JSON metadata
    "isMutable": true, // Can metadata be updated later?
    "creatorShare": 100 // Creator royalty share (0-100)
  },
  "wallet": {
    "minBalanceSol": 0.5, // Min SOL before requesting airdrop
    "airdropAmountSol": 2, // Airdrop amount (devnet only)
    "secretKeyEnv": "SOLANA_SECRET_KEY" // Env var name for secret key
  }
}
```

### Environment Variables

| Variable            | Overrides       | Required For   | Description                      |
| ------------------- | --------------- | -------------- | -------------------------------- |
| `PORT`              | `server.port`   | No             | HTTP server port                 |
| `API_KEY`           | `server.apiKey` | **Production** | API authentication key           |
| `SOLANA_RPC_URL`    | `solana.rpcUrl` | Mainnet        | Custom RPC endpoint              |
| `SOLANA_SECRET_KEY` | N/A (direct)    | **Production** | Base64-encoded wallet secret key |

---

## Security Model

### Secret Key Management

**Current State (Development)**:

- Secret key stored as `SOLANA_SECRET_KEY` environment variable
- Never committed to Git (`.gitignore` blocks `.env` files)
- Loaded at runtime from environment

**Production Recommendations**:

1. **Small Scale**: Dedicated secret manager (AWS Secrets Manager, GCP Secret Manager, HashiCorp Vault)
2. **Large Scale**: Hardware Security Module (HSM) or Multisig wallet
3. **Always**: Rotate keys regularly, use least privilege, audit access

### API Security

- API key authentication on all endpoints
- HTTPS required in production (not enforced in code, must be handled by reverse proxy/load balancer)
- No rate limiting implemented (consider adding `hono-rate-limiter` for production)

### Wallet Security

- Dedicated wallet recommended (not personal wallet)
- Keep minimal SOL balance (only what's needed for fees)
- Monitor for unusual activity
- Backup secret key securely (offline, encrypted)

---

## Development Workflow

### Setup

```bash
# Install dependencies
bun install

# Run development server (with auto-reload)
bun run dev

# Run production server
bun run start
```

### Testing

```bash
# Run all tests once
bun run test

# Run tests in watch mode
bun run test:watch
```

### Test Coverage

- **Config**: Loading, env overrides, BigInt conversions
- **Solana Service**: Wallet management, funding logic, token creation (mocked)
- **API**: Authentication, request/response, error handling, call order

---

## Deployment

### Devnet (Testing)

1. Ensure `config.json` has `"network": "devnet"`
2. Run `bun run wallet` to create a reusable wallet (`SOLANA_SECRET_KEY` in `.env`), open the printed faucet link and fund it once — otherwise every request depends on the rate-limited public faucet
3. Restart the server, then run `bun run start`
4. API only airdrops when the wallet balance drops below `wallet.minBalanceSol`

### Mainnet (Production)

1. **Wallet**: Create dedicated wallet, fund with 0.1-0.5 SOL
2. **RPC**: Get API key from Helius/QuickNode/Alchemy
3. **Config**: Set `"network": "mainnet-beta"` and custom `rpcUrl`
4. **Secrets**: Set `SOLANA_SECRET_KEY` and `API_KEY` env vars
5. **Metadata**: Upload `metadata/demo-token.json` to permanent URL (GitHub/Arweave/IPFS)
6. **Security**: Enable HTTPS, use secret manager, monitor activity

**Important**: On Mainnet, airdrops are disabled. `ensurePayerFunded` will throw an error if balance is insufficient.

---

## Common Tasks

### Change Token Name/Symbol

1. Edit `config.json` → `token.name` and `token.symbol`
2. Update `metadata/demo-token.json` with new details
3. Re-upload metadata JSON to permanent hosting
4. Update `config.json` → `token.metadataUri` with new URL

### Switch Networks

1. Edit `config.json` → `solana.network` (`"devnet"` or `"mainnet-beta"`)
2. (Mainnet only) Set `SOLANA_RPC_URL` env var
3. (Mainnet only) Ensure wallet is funded

### Add New Endpoint

1. Create route in `src/routes/` (follow `token.ts` pattern)
2. Add service logic in `src/services/` if needed
3. Mount route in `src/index.ts` with `app.route('/path', yourRoute)`
4. Add tests in `tests/api.test.ts`

### Rotate API Key

1. Generate new secure key
2. Set `API_KEY` env var (or update `config.json` for dev)
3. Restart server
4. Update clients with new key

---

## Troubleshooting

### "Devnet faucet unavailable for ... Fund the wallet manually"

**Cause**: The public devnet faucet (`api.devnet.solana.com`) is heavily rate-limited and often rejects requests with a generic `airdrop failed: Internal error`. The service already retries once with half the amount; this error means both attempts were rejected.

**Solution**: The lasting fix is a reused, once-funded wallet:

1. Run `bun run wallet` — it writes `SOLANA_SECRET_KEY` to `.env` and prints a faucet link
2. Open the link, request SOL once (fallback if also rate-limited: https://solfaucet.com)
3. Restart the server, then retry `POST /create-token`

Every request now reuses this funded wallet, so `ensurePayerFunded` never calls the faucet again. Manual alternative: paste the wallet address from the error message at https://faucet.solana.com and retry — but the next throwaway wallet will hit the same limit.

### "Insufficient balance on mainnet"

**Cause**: Wallet doesn't have enough SOL for transaction fees  
**Solution**: Send more SOL to the wallet address (check logs for address)

### "API key required" / "Invalid API key"

**Cause**: Missing or incorrect API key  
**Solution**: Provide valid key via `X-API-Key` header or `Authorization: Bearer` token

### "Metadata not showing in wallet"

**Cause**: Metadata URI not accessible or not properly formatted  
**Solution**:

1. Verify `metadataUri` is publicly accessible
2. Check JSON format matches Metaplex standard
3. Wait a few minutes (wallets cache metadata)

### Tests failing with "Mock not found"

**Cause**: Mocks not properly set up before imports  
**Solution**: Ensure `vi.mock()` calls are at top of test file, before any imports that use them

---

## Known Limitations

1. **No Rate Limiting**: API can be abused if exposed publicly. Add `hono-rate-limiter` for production.
2. **Single Wallet**: Only one payer wallet supported. Would need refactoring for multi-wallet support.
3. **Mutable Metadata**: Token metadata can be changed after creation (set `isMutable: false` for immutable).
4. **No Mint Authority Revocation**: Creator retains ability to mint more tokens. Consider revoking for trustlessness.

---

## Future Improvements

- [ ] Add rate limiting middleware
- [ ] Support for multiple wallets
- [ ] Option to revoke mint authority
- [ ] Integration with secret manager (AWS/GCP/Vault)
- [ ] Docker containerization
- [ ] CI/CD pipeline with automated testing
- [ ] Monitoring and alerting (e.g., Datadog, Sentry)
- [ ] Admin dashboard for token management

---

## Resources

- **Solana Docs**: https://docs.solana.com/
- **SPL Token Docs**: https://spl.solana.com/token
- **Metaplex Docs**: https://developers.metaplex.com/
- **Hono Docs**: https://hono.dev/
- **Bun Docs**: https://bun.sh/docs
- **Solana Explorer**: https://explorer.solana.com/

---

## Contact & Support

For questions or issues:

1. Check this document first
2. Review README.md for setup instructions
3. Check test files for usage examples
4. Review inline code comments for implementation details

---

**Last Updated**: August 23, 2026  
**Version**: 1.0.0  
**Maintainer**: Project Owner
