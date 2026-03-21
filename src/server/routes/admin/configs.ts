import { Hono } from "hono";
import type { AdminStore } from "../../db/admin-store.ts";
import type { AuthEnv, AuthUser } from "../../middleware/auth.ts";
import { requireRole } from "../../middleware/rbac.ts";
import { submitForReview, approve, reject } from "../../services/approval.ts";
import { publishConfig } from "../../services/publisher.ts";
import { canonicalJson } from "../../../core/canonical.ts";
import type { Config } from "../../../core/types.ts";

export function createConfigRoutes(store: AdminStore): Hono<AuthEnv> {
  const app = new Hono<AuthEnv>();

  // POST /configs - Create a draft config (publisher+)
  app.post("/", requireRole("publisher"), async (c) => {
    const user = c.get("user") as AuthUser;
    const body = await c.req.json<{
      base_version?: number;
      changes: Record<string, unknown>;
    }>();

    if (!body.changes || typeof body.changes !== "object") {
      return c.json({ error: "changes object is required" }, 400);
    }

    let configContent: Config;

    if (body.base_version) {
      const base = store.getConfigDetail(body.base_version);
      if (!base) {
        return c.json({ error: "Base version not found" }, 404);
      }
      const baseConfig = JSON.parse(base.config_content) as Config;
      configContent = { ...baseConfig, ...body.changes } as Config;
    } else {
      configContent = body.changes as Config;
    }

    const version = store.getNextConfigVersion();
    const canonical = canonicalJson(configContent);
    store.createConfig(version, canonical, user.id, body.base_version ?? null);

    return c.json({ version, status: "draft" }, 201);
  });

  // GET /configs - List all config versions with status
  app.get("/", (c) => {
    const configs = store.listConfigs();
    const result = configs.map((cfg) => ({
      version: cfg.version,
      status: cfg.status,
      author_id: cfg.author_id,
      base_version: cfg.base_version,
      created_at: cfg.created_at,
      submitted_at: cfg.submitted_at,
      approved_at: cfg.approved_at,
      published_at: cfg.published_at,
    }));
    return c.json(result);
  });

  // GET /configs/:version - View config detail + approvals
  app.get("/:version", (c) => {
    const version = parseInt(c.req.param("version"), 10);
    if (isNaN(version) || version < 1) {
      return c.json({ error: "Invalid version number" }, 400);
    }

    const config = store.getConfigDetail(version);
    if (!config) {
      return c.json({ error: "Config version not found" }, 404);
    }

    const approvals = store.getApprovalsByVersion(version);

    return c.json({
      version: config.version,
      status: config.status,
      config_content: JSON.parse(config.config_content),
      content_hash: config.content_hash,
      content_size: config.content_size,
      author_id: config.author_id,
      base_version: config.base_version,
      created_at: config.created_at,
      submitted_at: config.submitted_at,
      approved_at: config.approved_at,
      published_at: config.published_at,
      approvals: approvals.map((a) => ({
        reviewer_id: a.reviewer_id,
        decision: a.decision,
        comment: a.comment,
        created_at: a.created_at,
      })),
    });
  });

  // PUT /configs/:version - Edit draft config (publisher+)
  app.put("/:version", requireRole("publisher"), async (c) => {
    const version = parseInt(c.req.param("version"), 10);
    if (isNaN(version) || version < 1) {
      return c.json({ error: "Invalid version number" }, 400);
    }

    const config = store.getConfigDetail(version);
    if (!config) {
      return c.json({ error: "Config version not found" }, 404);
    }

    if (config.status !== "draft") {
      return c.json({ error: "Can only edit configs with status 'draft'" }, 400);
    }

    const user = c.get("user") as AuthUser;
    if (config.author_id !== user.id && user.role !== "admin") {
      return c.json({ error: "Only the author or an admin can edit this draft" }, 403);
    }

    const body = await c.req.json<{ changes: Record<string, unknown> }>();
    if (!body.changes || typeof body.changes !== "object") {
      return c.json({ error: "changes object is required" }, 400);
    }

    const currentConfig = JSON.parse(config.config_content) as Config;
    const updatedConfig = { ...currentConfig, ...body.changes } as Config;
    const canonical = canonicalJson(updatedConfig);
    store.updateConfigContent(version, canonical);

    return c.json({ version, status: "draft" });
  });

  // GET /configs/:version/diff - Diff with base version
  app.get("/:version/diff", (c) => {
    const version = parseInt(c.req.param("version"), 10);
    if (isNaN(version) || version < 1) {
      return c.json({ error: "Invalid version number" }, 400);
    }

    const config = store.getConfigDetail(version);
    if (!config) {
      return c.json({ error: "Config version not found" }, 404);
    }

    const current = JSON.parse(config.config_content);

    if (!config.base_version) {
      return c.json({ current, base: null, base_version: null });
    }

    const base = store.getConfigDetail(config.base_version);
    const baseContent = base ? JSON.parse(base.config_content) : null;

    return c.json({
      current,
      base: baseContent,
      base_version: config.base_version,
    });
  });

  // POST /configs/:version/submit - Submit for review (publisher+)
  app.post("/:version/submit", requireRole("publisher"), (c) => {
    const version = parseInt(c.req.param("version"), 10);
    if (isNaN(version) || version < 1) {
      return c.json({ error: "Invalid version number" }, 400);
    }

    const user = c.get("user") as AuthUser;
    const result = submitForReview(store, version, user.id);

    if (!result.success) {
      return c.json({ error: result.error }, 400);
    }

    return c.json({ version, status: "pending_review" });
  });

  // POST /configs/:version/approve - Approve (reviewer+)
  app.post("/:version/approve", requireRole("reviewer"), (c) => {
    const version = parseInt(c.req.param("version"), 10);
    if (isNaN(version) || version < 1) {
      return c.json({ error: "Invalid version number" }, 400);
    }

    const user = c.get("user") as AuthUser;
    const result = approve(store, version, user.id);

    if (!result.success) {
      return c.json({ error: result.error }, 400);
    }

    const newStatus = result.autoApproved ? "approved" : "pending_review";
    return c.json({ version, status: newStatus, auto_approved: result.autoApproved });
  });

  // POST /configs/:version/reject - Reject (reviewer+)
  app.post("/:version/reject", requireRole("reviewer"), async (c) => {
    const version = parseInt(c.req.param("version"), 10);
    if (isNaN(version) || version < 1) {
      return c.json({ error: "Invalid version number" }, 400);
    }

    const body = await c.req.json<{ comment?: string }>();
    const user = c.get("user") as AuthUser;
    const result = reject(store, version, user.id, body.comment ?? "");

    if (!result.success) {
      return c.json({ error: result.error }, 400);
    }

    return c.json({ version, status: "rejected" });
  });

  // POST /configs/:version/publish - Publish (publisher+)
  app.post("/:version/publish", requireRole("publisher"), async (c) => {
    const version = parseInt(c.req.param("version"), 10);
    if (isNaN(version) || version < 1) {
      return c.json({ error: "Invalid version number" }, 400);
    }

    const body = await c.req.json<{ key_id: string; expires_in_seconds?: number }>();
    if (!body.key_id) {
      return c.json({ error: "key_id is required" }, 400);
    }

    const result = await publishConfig(store, version, body.key_id, body.expires_in_seconds);

    if (!result.success) {
      return c.json({ error: result.error }, 400);
    }

    return c.json({ version, status: "published", signature: result.signature });
  });

  return app;
}
