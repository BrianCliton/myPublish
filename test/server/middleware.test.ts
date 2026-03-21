import { describe, test, expect, beforeEach, afterEach } from "bun:test";

process.env.NODE_ENV = "test";

import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { sign } from "hono/jwt";
import { AdminStore } from "../../src/server/db/admin-store.ts";
import { createAuthMiddleware, createUserExtractMiddleware, createLoginRoute, type AuthEnv } from "../../src/server/middleware/auth.ts";
import { hasRole, requireRole } from "../../src/server/middleware/rbac.ts";

const JWT_SECRET = "test-secret-key-for-e2e";

describe("Auth Middleware", () => {
  let store: AdminStore;

  beforeEach(() => {
    store = new AdminStore(":memory:");
    store.runMigrations();
    process.env.JWT_SECRET = JWT_SECRET;
  });

  afterEach(() => {
    store.close();
    delete process.env.JWT_SECRET;
  });

  function createTestApp(): Hono {
    const app = new Hono();

    app.onError((err, c) => {
      if (err instanceof HTTPException) {
        return c.json({ error: err.message }, err.status);
      }
      return c.json({ error: "Internal server error" }, 500);
    });

    app.use("/protected/*", createAuthMiddleware());
    app.use("/protected/*", createUserExtractMiddleware());
    app.get("/protected/me", (c) => {
      const user = c.get("user" as any);
      return c.json(user);
    });

    const loginRoutes = createLoginRoute(store);
    app.route("/auth", loginRoutes);

    return app;
  }

  async function makeToken(sub: string, username: string, role: string): Promise<string> {
    const now = Math.floor(Date.now() / 1000);
    return sign({ sub, username, role, exp: now + 3600 }, JWT_SECRET);
  }

  test("rejects request without Authorization header", async () => {
    const app = createTestApp();
    const res = await app.fetch(new Request("http://localhost/protected/me"));
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toBeDefined();
  });

  test("rejects request with invalid token", async () => {
    const app = createTestApp();
    const res = await app.fetch(
      new Request("http://localhost/protected/me", {
        headers: { Authorization: "Bearer invalid-token" },
      }),
    );
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toBeDefined();
  });

  test("accepts valid token and sets user context", async () => {
    const app = createTestApp();
    const token = await makeToken("user-1", "admin", "admin");
    const res = await app.fetch(
      new Request("http://localhost/protected/me", {
        headers: { Authorization: `Bearer ${token}` },
      }),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.id).toBe("user-1");
    expect(body.username).toBe("admin");
    expect(body.role).toBe("admin");
  });

  test("rejects non-Bearer auth header", async () => {
    const app = createTestApp();
    const res = await app.fetch(
      new Request("http://localhost/protected/me", {
        headers: { Authorization: "Basic dXNlcjpwYXNz" },
      }),
    );
    expect(res.status).toBe(401);
  });
});

describe("Login Route", () => {
  let store: AdminStore;

  beforeEach(async () => {
    store = new AdminStore(":memory:");
    store.runMigrations();
    process.env.JWT_SECRET = JWT_SECRET;

    const hash = await Bun.password.hash("secret123");
    store.createUser("user-1", "admin", hash, "admin");
  });

  afterEach(() => {
    store.close();
    delete process.env.JWT_SECRET;
  });

  function createLoginApp(): Hono {
    const app = new Hono();
    app.route("/auth", createLoginRoute(store));
    return app;
  }

  test("returns token for valid credentials", async () => {
    const app = createLoginApp();
    const res = await app.fetch(
      new Request("http://localhost/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: "admin", password: "secret123" }),
      }),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.token).toBeDefined();
    expect(body.user.username).toBe("admin");
  });

  test("rejects invalid password", async () => {
    const app = createLoginApp();
    const res = await app.fetch(
      new Request("http://localhost/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: "admin", password: "wrong" }),
      }),
    );
    expect(res.status).toBe(401);
  });

  test("rejects unknown user", async () => {
    const app = createLoginApp();
    const res = await app.fetch(
      new Request("http://localhost/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: "nobody", password: "secret123" }),
      }),
    );
    expect(res.status).toBe(401);
  });

  test("rejects missing fields", async () => {
    const app = createLoginApp();
    const res = await app.fetch(
      new Request("http://localhost/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: "admin" }),
      }),
    );
    expect(res.status).toBe(400);
  });
});

describe("RBAC", () => {
  test("hasRole: admin has all roles", () => {
    expect(hasRole({ id: "1", username: "a", role: "admin" }, "admin")).toBe(true);
    expect(hasRole({ id: "1", username: "a", role: "admin" }, "publisher")).toBe(true);
    expect(hasRole({ id: "1", username: "a", role: "admin" }, "reviewer")).toBe(true);
  });

  test("hasRole: publisher has publisher and reviewer", () => {
    expect(hasRole({ id: "1", username: "a", role: "publisher" }, "admin")).toBe(false);
    expect(hasRole({ id: "1", username: "a", role: "publisher" }, "publisher")).toBe(true);
    expect(hasRole({ id: "1", username: "a", role: "publisher" }, "reviewer")).toBe(true);
  });

  test("hasRole: reviewer has only reviewer", () => {
    expect(hasRole({ id: "1", username: "a", role: "reviewer" }, "admin")).toBe(false);
    expect(hasRole({ id: "1", username: "a", role: "reviewer" }, "publisher")).toBe(false);
    expect(hasRole({ id: "1", username: "a", role: "reviewer" }, "reviewer")).toBe(true);
  });

  test("hasRole: unknown role has no permissions", () => {
    expect(hasRole({ id: "1", username: "a", role: "unknown" }, "admin")).toBe(false);
  });

  test("requireRole middleware rejects unauthenticated request", async () => {
    const app = new Hono();
    app.use("/*", requireRole("admin"));
    app.get("/", (c) => c.json({ ok: true }));

    const res = await app.fetch(new Request("http://localhost/"));
    expect(res.status).toBe(401);
  });

  test("requireRole middleware rejects insufficient role", async () => {
    const app = new Hono();
    app.use("/*", async (c, next) => {
      c.set("user" as any, { id: "1", username: "reviewer", role: "reviewer" });
      await next();
    });
    app.use("/*", requireRole("admin"));
    app.get("/", (c) => c.json({ ok: true }));

    const res = await app.fetch(new Request("http://localhost/"));
    expect(res.status).toBe(403);
  });

  test("requireRole middleware allows sufficient role", async () => {
    const app = new Hono();
    app.use("/*", async (c, next) => {
      c.set("user" as any, { id: "1", username: "admin", role: "admin" });
      await next();
    });
    app.use("/*", requireRole("admin"));
    app.get("/", (c) => c.json({ ok: true }));

    const res = await app.fetch(new Request("http://localhost/"));
    expect(res.status).toBe(200);
  });
});
