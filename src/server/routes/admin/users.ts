import { Hono } from "hono";
import type { AdminStore } from "../../db/admin-store.ts";
import type { AuthEnv } from "../../middleware/auth.ts";
import { requireRole } from "../../middleware/rbac.ts";

export function createUserRoutes(store: AdminStore): Hono<AuthEnv> {
  const app = new Hono<AuthEnv>();

  // POST /users - Create a new user (admin only)
  app.post("/", requireRole("admin"), async (c) => {
    const body = await c.req.json<{
      username: string;
      password: string;
      role: string;
    }>();

    if (!body.username || !body.password || !body.role) {
      return c.json({ error: "username, password, and role are required" }, 400);
    }

    if (typeof body.password !== "string" || body.password.length < 12) {
      return c.json({ error: "Password must be at least 12 characters" }, 400);
    }

    if (!["admin", "publisher", "reviewer"].includes(body.role)) {
      return c.json({ error: "role must be admin, publisher, or reviewer" }, 400);
    }

    const existing = store.getUserByUsername(body.username);
    if (existing) {
      return c.json({ error: "Username already exists" }, 409);
    }

    const id = crypto.randomUUID();
    const passwordHash = await Bun.password.hash(body.password);
    store.createUser(id, body.username, passwordHash, body.role);

    return c.json(
      { id, username: body.username, role: body.role },
      201,
    );
  });

  // GET /users - List all users (admin only)
  app.get("/", requireRole("admin"), (c) => {
    const users = store.listUsers();
    const sanitized = users.map((u) => ({
      id: u.id,
      username: u.username,
      role: u.role,
      created_at: u.created_at,
    }));
    return c.json(sanitized);
  });

  return app;
}
