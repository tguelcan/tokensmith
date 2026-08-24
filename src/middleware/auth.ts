import { createMiddleware } from "hono/factory";
import { config } from "../config.ts";

/**
 * API key authentication middleware.
 * Checks for X-API-Key header or Authorization: Bearer token.
 * Returns 401 if no key provided, 403 if invalid.
 */
export const apiKeyAuth = createMiddleware(async (c, next) => {
  const apiKey =
    c.req.header("X-API-Key") ??
    c.req.header("Authorization")?.replace(/^Bearer\s+/i, "");

  if (!apiKey) {
    return c.json(
      {
        success: false,
        error:
          "API key required. Provide X-API-Key header or Authorization: Bearer token.",
      },
      401,
    );
  }

  if (apiKey !== config.server.apiKey) {
    return c.json(
      {
        success: false,
        error: "Invalid API key",
      },
      403,
    );
  }

  await next();
});
