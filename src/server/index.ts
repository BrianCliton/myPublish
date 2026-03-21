import { Hono } from "hono";
import { Store } from "./db/store.ts";
import { createPublicRoutes } from "./routes/public.ts";

export interface ServerOptions {
  readonly dbPath?: string;
  readonly port?: number;
}

export interface ServerInstance {
  readonly app: Hono;
  readonly store: Store;
  readonly stop: () => void;
}

export function createApp(store: Store): Hono {
  const app = new Hono();

  app.onError((err, c) => {
    console.error("[server error]", err.message);
    return c.json({ error: "Internal server error" }, 500);
  });

  const publicRoutes = createPublicRoutes(store);
  app.route("/v1", publicRoutes);
  return app;
}

export function startServer(options: ServerOptions = {}): ServerInstance {
  const dbPath = options.dbPath ?? "publish.db";
  const port = options.port ?? parseInt(process.env.PORT ?? "3000", 10);

  const store = new Store(dbPath);
  store.runMigrations();

  const app = createApp(store);

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
