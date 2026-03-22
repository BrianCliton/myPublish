import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { secureHeaders } from "hono/secure-headers";
import { Store } from "./db/store.ts";
import { AdminStore } from "./db/admin-store.ts";
import { createPublicRoutes } from "./routes/public.ts";
import { createAuthMiddleware, createUserExtractMiddleware, createLoginRoute } from "./middleware/auth.ts";
import { createUserRoutes } from "./routes/admin/users.ts";
import { createConfigRoutes } from "./routes/admin/configs.ts";
import { createKeyRoutes } from "./routes/admin/keys.ts";
import { createRateLimiter } from "./middleware/rate-limit.ts";
import { createDevRoutes } from "./routes/dev.ts";
import { createDevUiRoute } from "./routes/devui.ts";

export interface ServerOptions {
  readonly dbPath?: string;
  readonly port?: number;
}

export interface ServerInstance {
  readonly app: Hono;
  readonly store: AdminStore;
  readonly stop: () => void;
}

export function createApp(store: Store): Hono {
  const app = new Hono();

  app.use("/*", secureHeaders());

  app.onError((err, c) => {
    if (err instanceof HTTPException) {
      return c.json({ error: err.message }, err.status);
    }
    console.error("[server error]", err.stack ?? err.message);
    return c.json({ error: "Internal server error" }, 500);
  });

  const publicRoutes = createPublicRoutes(store);
  app.route("/v1", publicRoutes);

  if (store instanceof AdminStore) {
    const loginRoute = createLoginRoute(store);
    // Rate limit login: 5 attempts per 15 minutes per IP
    loginRoute.use("/login", createRateLimiter({ windowMs: 15 * 60 * 1000, maxRequests: 5 }));
    app.route("/v1/admin/auth", loginRoute);

    const adminApp = new Hono();
    adminApp.use("/*", createAuthMiddleware());
    adminApp.use("/*", createUserExtractMiddleware());

    const userRoutes = createUserRoutes(store);
    adminApp.route("/users", userRoutes);

    const configRoutes = createConfigRoutes(store);
    adminApp.route("/configs", configRoutes);

    const keyRoutes = createKeyRoutes(store);
    adminApp.route("/keys", keyRoutes);

    app.route("/v1/admin", adminApp);
  }

  return app;
}

export function startServer(options: ServerOptions = {}): ServerInstance {
  const isDevUi = process.env.DEV_UI === "true";

  if (isDevUi) {
    // Set safe defaults so the server starts with a single command, no .env needed
    process.env.JWT_SECRET ??= "dev-jwt-secret-do-not-use-in-production";
    process.env.KEY_ENCRYPTION_KEY ??= "dev-key-encryption-key-do-not-use-in-production";
    process.env.MIN_APPROVALS ??= "1"; // Only 1 reviewer needed in dev
  }

  // In dev UI mode, use an in-memory DB so every restart is a clean slate
  const dbPath = options.dbPath ?? (isDevUi ? ":memory:" : "publish.db");
  const port = options.port ?? parseInt(process.env.PORT ?? "3000", 10);

  const store = new AdminStore(dbPath);
  store.runMigrations();

  const app = createApp(store);

  if (isDevUi) {
    const devRoutes = createDevRoutes(store);
    app.route("/dev", devRoutes);
    const devUi = createDevUiRoute();
    app.route("/dev", devUi);
    console.log(`Dev UI:    http://localhost:${port}/dev`);
  }

  const server = Bun.serve({
    fetch: app.fetch,
    port,
  });

  console.log(`Server running on http://localhost:${server.port}`);

  return {
    app,
    store,
    stop: () => {
      server.stop();
      store.close();
    },
  };
}

// Run if executed directly
if (import.meta.main) {
  startServer();
}
