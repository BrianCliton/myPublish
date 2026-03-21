import type { AuthUser } from "./auth.ts";

const ROLE_HIERARCHY: Record<string, readonly string[]> = {
  admin: ["admin", "publisher", "reviewer"],
  publisher: ["publisher", "reviewer"],
  reviewer: ["reviewer"],
};

export function hasRole(user: AuthUser, ...requiredRoles: readonly string[]): boolean {
  const userPermissions = ROLE_HIERARCHY[user.role] ?? [];
  return requiredRoles.some((role) => userPermissions.includes(role));
}

export function requireRole(...roles: readonly string[]) {
  return async (c: { get: (key: string) => unknown; json: (body: unknown, status: number) => Response }, next: () => Promise<void>) => {
    const user = c.get("user") as AuthUser | undefined;
    if (!user) {
      return c.json({ error: "Authentication required" }, 401);
    }

    if (!hasRole(user, ...roles)) {
      return c.json({ error: "Insufficient permissions" }, 403);
    }

    await next();
  };
}
