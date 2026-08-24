import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { config } from "./config.ts";
import tokenRoutes from "./routes/token.ts";

const app = new Hono();

// Mount route blueprints
app.route("/", tokenRoutes);

serve(
  {
    fetch: app.fetch,
    port: config.server.port,
  },
  (info) => {
    console.log(`Server is running on http://localhost:${info.port}`);
  },
);
