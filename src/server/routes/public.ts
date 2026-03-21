import { Hono } from "hono";
import type { Store } from "../db/store.ts";

export function createPublicRoutes(store: Store): Hono {
  const app = new Hono();

  // GET /v1/keys - Returns latest KeyList (root-signed)
  app.get("/keys", (c) => {
    const keyList = store.getLatestKeyList();
    if (!keyList) {
      return c.json({ error: "No key list published yet" }, 404);
    }
    return c.json(keyList);
  });

  // GET /v1/config/latest - Returns { manifest, config } for latest published config
  app.get("/config/latest", (c) => {
    const result = store.getLatestPublishedConfig();
    if (!result) {
      return c.json({ error: "No config published yet" }, 404);
    }

    const etag = `"v${result.manifest.version}"`;

    const ifNoneMatch = c.req.header("If-None-Match");
    if (ifNoneMatch === etag) {
      return c.body(null, 304);
    }

    c.header("ETag", etag);
    return c.json(result);
  });

  // GET /v1/config/latest/manifest - Returns { manifest } only (lightweight check)
  app.get("/config/latest/manifest", (c) => {
    const result = store.getLatestPublishedConfig();
    if (!result) {
      return c.json({ error: "No config published yet" }, 404);
    }

    const etag = `"v${result.manifest.version}"`;

    const ifNoneMatch = c.req.header("If-None-Match");
    if (ifNoneMatch === etag) {
      return c.body(null, 304);
    }

    c.header("ETag", etag);
    return c.json({ manifest: result.manifest });
  });

  // GET /v1/config/:version - Returns specific published version
  app.get("/config/:version", (c) => {
    const versionStr = c.req.param("version");
    const version = parseInt(versionStr, 10);

    if (isNaN(version) || version < 1) {
      return c.json({ error: "Invalid version number" }, 400);
    }

    const result = store.getConfigByVersion(version);
    if (!result) {
      return c.json({ error: "Config version not found or not published" }, 404);
    }

    const etag = `"v${result.manifest.version}"`;
    c.header("ETag", etag);
    return c.json(result);
  });

  return app;
}
