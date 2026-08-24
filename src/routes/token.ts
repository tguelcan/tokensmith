import { Hono } from "hono";
import {
  createTokenWithSupply,
  ensurePayerFunded,
  loadPayer,
  TokenUpdateError,
  updateTokenMetadata,
  type MetadataChanges,
  type UpdateFailure,
} from "../services/solana.ts";
import { apiKeyAuth } from "../middleware/auth.ts";
import { config } from "../config.ts";

/**
 * Token routes blueprint.
 * Mounted by the main application (e.g. under "/").
 */
const tokenRoutes = new Hono();

tokenRoutes.use("/*", apiKeyAuth);

const UPDATE_FAILURE_STATUS: Record<UpdateFailure, 404 | 403 | 409> = {
  "not-found": 404,
  "wrong-authority": 403,
  immutable: 409,
};

/**
 * POST /create-token
 * Creates a new SPL token with Metaplex metadata (name, symbol, image)
 * on the configured Solana network.
 * Requires valid API key in X-API-Key header or Authorization: Bearer token.
 */
tokenRoutes.post("/create-token", async (c) => {
  try {
    const payer = loadPayer();
    await ensurePayerFunded(payer);
    const token = await createTokenWithSupply(payer);

    return c.json({
      success: true,
      network: config.solana.network,
      ...token,
    });
  } catch (error) {
    return c.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      },
      500,
    );
  }
});

/**
 * PATCH /token/:mint
 * Updates the on-chain name, symbol or uri of an existing token.
 * The image lives in the JSON behind the uri and needs no request at all.
 */
tokenRoutes.patch("/token/:mint", async (c) => {
  const mint = c.req.param("mint");

  let body: MetadataChanges;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ success: false, error: "Request body must be JSON" }, 400);
  }

  const changes: MetadataChanges = {};
  for (const field of ["name", "symbol", "uri"] as const) {
    const value = body?.[field];
    if (value === undefined) continue;
    if (typeof value !== "string" || value.trim() === "") {
      return c.json(
        { success: false, error: `"${field}" must be a non-empty string` },
        400,
      );
    }
    changes[field] = value;
  }

  if (Object.keys(changes).length === 0) {
    return c.json(
      { success: false, error: "Provide at least one of: name, symbol, uri" },
      400,
    );
  }

  try {
    const payer = loadPayer();
    const token = await updateTokenMetadata(payer, mint, changes);

    return c.json({
      success: true,
      network: config.solana.network,
      ...token,
    });
  } catch (error) {
    if (error instanceof TokenUpdateError) {
      return c.json(
        { success: false, error: error.message },
        UPDATE_FAILURE_STATUS[error.reason],
      );
    }
    return c.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      },
      500,
    );
  }
});

export default tokenRoutes;
