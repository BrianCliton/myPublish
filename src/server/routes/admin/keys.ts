import { Hono } from "hono";
import type { AdminStore } from "../../db/admin-store.ts";
import type { AuthEnv } from "../../middleware/auth.ts";
import { requireRole } from "../../middleware/rbac.ts";
import {
  generateSigningKey,
  revokeKey,
  publishKeyList,
} from "../../services/keymanager.ts";

export function createKeyRoutes(store: AdminStore): Hono<AuthEnv> {
  const app = new Hono<AuthEnv>();

  // GET /keys - List signing keys (admin only)
  app.get("/", requireRole("admin"), (c) => {
    const keys = store.listSigningKeys();
    const sanitized = keys.map((k) => ({
      key_id: k.key_id,
      public_key: k.public_key,
      status: k.status,
      not_before: k.not_before,
      not_after: k.not_after,
      created_at: k.created_at,
      revoked_at: k.revoked_at,
    }));
    return c.json(sanitized);
  });

  // POST /keys - Generate new signing key pair (admin only)
  app.post("/", requireRole("admin"), async (c) => {
    const body = await c.req.json<{ validity_days?: number }>().catch(() => ({}));
    const result = await generateSigningKey(store, body.validity_days);

    if (!result.success) {
      return c.json({ error: result.error }, 500);
    }

    return c.json(
      { key_id: result.keyId, public_key: result.publicKey },
      201,
    );
  });

  // POST /keys/:id/revoke - Revoke a signing key (admin only)
  app.post("/:id/revoke", requireRole("admin"), (c) => {
    const keyId = c.req.param("id");
    const result = revokeKey(store, keyId);

    if (!result.success) {
      return c.json({ error: result.error }, 400);
    }

    return c.json({ key_id: keyId, status: "revoked" });
  });

  // POST /keys/publish-list - Publish new KeyList (admin only)
  // Root private key is NEVER accepted via HTTP - must be set as env var
  app.post("/publish-list", requireRole("admin"), async (c) => {
    const rootKey = process.env.ROOT_PRIVATE_KEY;

    if (!rootKey) {
      return c.json({ error: "ROOT_PRIVATE_KEY environment variable is required" }, 400);
    }

    const result = await publishKeyList(store, rootKey);

    if (!result.success) {
      return c.json({ error: result.error }, 400);
    }

    return c.json({ list_sequence: result.listSequence }, 201);
  });

  return app;
}
