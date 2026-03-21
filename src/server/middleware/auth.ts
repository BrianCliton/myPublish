import { Hono } from "hono";
import { jwt, sign } from "hono/jwt";
import type { AdminStore } from "../db/admin-store.ts";

export interface JwtPayload {
  readonly sub: string;
  readonly username: string;
  readonly role: string;
  readonly exp: number;
  readonly iat: number;
  readonly iss: string;
  readonly aud: string;
}

export interface AuthUser {
  readonly id: string;
  readonly username: string;
  readonly role: string;
}

export type AuthEnv = {
  Variables: {
    user: AuthUser;
    jwtPayload: JwtPayload;
  };
};

function getJwtSecret(): string {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    throw new Error("JWT_SECRET environment variable is required");
  }
  return secret;
}

export function createAuthMiddleware() {
  return jwt({ secret: getJwtSecret(), alg: "HS256" });
}

export function createUserExtractMiddleware() {
  return async (c: { get: (key: string) => unknown; set: (key: string, value: unknown) => void }, next: () => Promise<void>) => {
    const payload = c.get("jwtPayload") as JwtPayload;
    if (payload) {
      c.set("user", {
        id: payload.sub,
        username: payload.username,
        role: payload.role,
      } as AuthUser);
    }
    await next();
  };
}

export function createLoginRoute(store: AdminStore): Hono {
  const app = new Hono();

  app.post("/login", async (c) => {
    const body = await c.req.json<{ username: string; password: string }>();

    if (!body.username || !body.password) {
      return c.json({ error: "Username and password are required" }, 400);
    }

    const user = store.getUserByUsername(body.username);
    if (!user) {
      return c.json({ error: "Invalid credentials" }, 401);
    }

    const valid = await Bun.password.verify(body.password, user.password_hash);
    if (!valid) {
      return c.json({ error: "Invalid credentials" }, 401);
    }

    const secret = getJwtSecret();
    const now = Math.floor(Date.now() / 1000);
    const payload: JwtPayload = {
      sub: user.id,
      username: user.username,
      role: user.role,
      exp: now + 3600, // 1 hour TTL
      iat: now,
      iss: "publish-server",
      aud: "publish-admin",
    };

    const token = await sign(payload as unknown as Record<string, unknown>, secret);
    return c.json({ token, user: { id: user.id, username: user.username, role: user.role } });
  });

  return app;
}
