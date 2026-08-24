import { Hono } from "hono";
import {
  createTokenWithSupply,
  ensurePayerFunded,
  loadPayer,
} from "../services/solana.ts";
import { apiKeyAuth } from "../middleware/auth.ts";
import { config } from "../config.ts";

/**
 * Token routes blueprint.
 * Mounted by the main application (e.g. under "/").
 */
const tokenRoutes = new Hono();

tokenRoutes.use("/*", apiKeyAuth);

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

export default tokenRoutes;
