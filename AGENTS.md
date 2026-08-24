# AI Assistant Guidelines

This file provides context and guidelines for AI assistants working with this codebase.

## Project Overview

**TokenSmith** is a TypeScript-based API that creates SPL tokens with Metaplex metadata on the Solana blockchain. It uses:

- **Runtime**: Bun
- **Framework**: Hono
- **Blockchain**: Solana (Web3.js + SPL Token + Metaplex)
- **Testing**: Vitest

## Core Principles

1. **Security First**: Never commit secrets. Always use environment variables for sensitive data.
2. **Config-Driven**: All settings in `config.json` with env var overrides. `src/config.ts` is the _only_ place that reads `process.env` — never read env vars directly in routes or services.
3. **Test Coverage**: All blockchain calls must be mocked in tests.
4. **Documentation**: Keep `PROJECT_KNOWLEDGE.md` up-to-date.

## Invariants

Violating these has caused real bugs — see Learnings.

- **No module-level caching of payer-derived state.** `loadPayer()` returns a _new_ keypair on every call when `SOLANA_SECRET_KEY` is unset. Anything built from a payer (UMI client, signer, identity) must be created per request.
- **`process.env` only in `src/config.ts`.** An env var read elsewhere is invisible to config, README and tests, and silently diverges from `config.json`.
- **Program IDs and other on-chain constants live at module scope**, not inline in functions.
- **Token creation goes through `createAndMint`**, never `createMint` + `createV1` — the metadata program needs the mint as a signer.
- **Destructure UMI PDAs.** They are `[address, bump]` tuples; `.toString()` on the tuple leaks the bump into responses.
- **Config values carry their real types.** `network` is `Cluster`, `commitment` is `Commitment` (typed in `config.ts`), so consumers need no `as` casts.

## File Structure

```
src/
  index.ts           # Entry point
  config.ts          # Config loader
  middleware/auth.ts # API key auth
  routes/token.ts    # API endpoints
  services/solana.ts # Blockchain logic
tests/               # Test files (mocked)
config.json          # Default config
PROJECT_KNOWLEDGE.md # Full documentation
```

## Key Patterns

### Adding a New Route

1. Create route file in `src/routes/`
2. Import service functions from `src/services/`
3. Apply auth middleware if needed
4. Mount in `src/index.ts`
5. Add tests in `tests/api.test.ts`

### Modifying Config

1. Update `config.json` with defaults
2. Add env var override in `src/config.ts`
3. Update `PROJECT_KNOWLEDGE.md` documentation
4. Add tests in `tests/config.test.ts`

## Security Requirements

- **API Keys**: Required for all endpoints (`X-API-Key` header or `Authorization: Bearer`)
- **Secret Keys**: Store in env vars (`SOLANA_SECRET_KEY`), never in code
- **Networks**: Devnet for testing, Mainnet for production (different RPC endpoints)

## Testing Guidelines

- Mock all blockchain calls (Solana, Metaplex)
- Test authentication (401, 403, 200 cases)
- Test error handling (500 responses)
- Run `bun run test` before committing

### Test Hygiene

- Build config mocks through the `makeConfig()` helper in `tests/solana.test.ts` instead of copying the whole object — duplicated mocks drift apart.
- `vi.doMock()` + `vi.resetModules()` leaks into later tests in the same file. Always re-apply the mock (see `importService()`), never only in the tests that override something.
- A test that builds its expected value with the same expression as the assertion tests nothing. Assert against literals.
- `bun run test` loads `.env` into `process.env`, so ambient values reach `config.ts`. `tests/config.test.ts` deletes the override vars in `beforeEach` — keep that list in sync when adding a new env var.

## Learnings

- 2026-08-24: `createV1` was called with a mint created beforehand via SPL-Token's `createMint`, passing only the address. The program rejects this with `custom program error: 0x86` / "Mint needs to be signer to initialize the account" — `create.rs` requires the mint account to sign when it does not yet exist. Fixed by switching to `createAndMint` with a UMI `generateSigner(umi)` mint, which creates the mint, attaches metadata and mints the supply in **one** transaction. `@solana/spl-token` is no longer a dependency.
- 2026-08-24: UMI returns PDAs as `[address, bump]` tuples, so `findMetadataPda(...).toString()` produced `"DRBbUb…,255"` in the API response. Always destructure: `const [metadataAddress] = findMetadataPda(...)`. The test mocked the PDA as an object with `toString()`, which hid the bug — mocks must mirror the real tuple shape.
- 2026-08-24: `vitest.config.ts` sets `mockReset: true`, which discards `.mockReturnValue()` before each test. Mocks defined inside a `vi.mock()` factory must use `vi.fn(() => value)` — that implementation is restored on reset, `mockReturnValue` is not.
- 2026-08-24: `requestAirdrop` on the public devnet cluster fails nondeterministically with `airdrop failed: Internal error` (faucet rate limits, per IP and per address; larger amounts are rejected more often). `ensurePayerFunded` now calls `requestAirdropWithRetry`: one retry after 2 s with half the amount, and the final error points to https://faucet.solana.com. Requests are ~30 s apart in practice, so only the throwaway-wallet flow (unset `SOLANA_SECRET_KEY`) hits this. The first failure is logged as a warning — informational, not an API error.
- 2026-08-24: `getUmi()` cached the UMI client in a module-level variable while ignoring the `payer` argument. Because `loadPayer()` generates a fresh keypair per request when no secret key is configured, every request after the first signed metadata with the _previous_ request's identity — wrong mint authority and wrong `creators[0].address`. Fixed by removing the cache (`createUmiFor(payer)`).
- 2026-08-24: `routes/token.ts` returned `network: process.env.SOLANA_NETWORK ?? "devnet"`. That env var existed nowhere else — not in `config.ts`, `config.json` or the README — so the API reported `devnet` even when configured for `mainnet-beta`. Fixed by using `config.solana.network`.
- 2026-08-24: `findMetadataPda()` constructed `new PublicKey("metaqbxx…")` twice per call with the address literal duplicated. Hoisted to `TOKEN_METADATA_PROGRAM_ID`.
- 2026-08-24: The config mock object was copy-pasted four times in `tests/solana.test.ts` (~120 lines). Beyond the noise, a `vi.doMock` for mainnet leaked into the following test, which then had to defensively re-mock devnet. Replaced by `makeConfig()` + `importService()`.

## Documentation

- **README.md**: User-facing setup and usage
- **PROJECT_KNOWLEDGE.md**: Complete technical documentation
- **This file**: AI-specific guidelines and context

## When in Doubt

1. Check `PROJECT_KNOWLEDGE.md` for detailed explanations
2. Look at test files for usage examples
3. Review inline code comments
4. Ask for clarification if requirements are unclear
