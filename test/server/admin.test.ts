import { describe, test, expect, beforeAll, afterAll, beforeEach, afterEach } from "bun:test";
import { Hono } from "hono";
import { sign } from "hono/jwt";
import { AdminStore } from "../../src/server/db/admin-store.ts";
import { createApp } from "../../src/server/index.ts";
import {
  generateKeyPair,
  publicKeyToBase64,
  uint8ArrayToBase64,
} from "../../src/core/signing.ts";

const JWT_SECRET = "test-jwt-secret-for-testing-only";
const TEST_PASSWORD = "secure-password-123";

// Set env vars before tests
process.env.JWT_SECRET = JWT_SECRET;
process.env.KEY_ENCRYPTION_KEY = "test-encryption-key-for-ci";
process.env.NODE_ENV = "test";
process.env.MIN_APPROVALS = "2";

// --- Helpers ---

async function createToken(payload: {
  sub: string;
  username: string;
  role: string;
}): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  return sign(
    { ...payload, exp: now + 3600 },
    JWT_SECRET,
  );
}

function authHeader(token: string): Record<string, string> {
  return { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
}

async function setupStore(): Promise<AdminStore> {
  const store = new AdminStore(":memory:");
  store.runMigrations();

  // Seed admin user
  const hash = await Bun.password.hash(TEST_PASSWORD);
  store.createUser("admin-1", "admin", hash, "admin");
  store.createUser("publisher-1", "publisher1", hash, "publisher");
  store.createUser("publisher-2", "publisher2", hash, "publisher");
  store.createUser("reviewer-1", "reviewer1", hash, "reviewer");
  store.createUser("reviewer-2", "reviewer2", hash, "reviewer");

  return store;
}

// --- Tests ---

describe("Admin API", () => {
  let store: AdminStore;
  let app: Hono;
  let adminToken: string;
  let publisherToken: string;
  let publisher2Token: string;
  let reviewerToken: string;
  let reviewer2Token: string;

  beforeAll(async () => {
    store = await setupStore();
    app = createApp(store);

    adminToken = await createToken({ sub: "admin-1", username: "admin", role: "admin" });
    publisherToken = await createToken({ sub: "publisher-1", username: "publisher1", role: "publisher" });
    publisher2Token = await createToken({ sub: "publisher-2", username: "publisher2", role: "publisher" });
    reviewerToken = await createToken({ sub: "reviewer-1", username: "reviewer1", role: "reviewer" });
    reviewer2Token = await createToken({ sub: "reviewer-2", username: "reviewer2", role: "reviewer" });
  });

  afterAll(() => {
    store.close();
  });

  function request(
    method: string,
    path: string,
    body?: unknown,
    headers: Record<string, string> = {},
  ) {
    const opts: RequestInit = { method, headers };
    if (body) {
      opts.body = JSON.stringify(body);
      headers["Content-Type"] = "application/json";
    }
    return app.fetch(new Request(`http://localhost${path}`, opts));
  }

  // --- Auth Tests ---

  describe("Authentication", () => {
    test("POST /v1/admin/auth/login - valid credentials", async () => {
      const res = await request("POST", "/v1/admin/auth/login", {
        username: "admin",
        password: TEST_PASSWORD,
      });
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body.token).toBeDefined();
      expect(body.user.id).toBe("admin-1");
      expect(body.user.role).toBe("admin");
    });

    test("POST /v1/admin/auth/login - invalid password", async () => {
      const res = await request("POST", "/v1/admin/auth/login", {
        username: "admin",
        password: "wrong-password",
      });
      expect(res.status).toBe(401);
    });

    test("POST /v1/admin/auth/login - non-existent user", async () => {
      const res = await request("POST", "/v1/admin/auth/login", {
        username: "nobody",
        password: "password",
      });
      expect(res.status).toBe(401);
    });

    test("POST /v1/admin/auth/login - missing fields", async () => {
      const res = await request("POST", "/v1/admin/auth/login", {
        username: "admin",
      });
      expect(res.status).toBe(400);
    });

    test("admin endpoint rejects missing token", async () => {
      const res = await request("GET", "/v1/admin/users");
      expect(res.status).toBe(401);
    });

    test("admin endpoint rejects invalid token", async () => {
      const res = await request("GET", "/v1/admin/users", undefined, {
        Authorization: "Bearer invalid-token",
      });
      expect(res.status).toBe(401);
    });

    test("admin endpoint accepts valid token", async () => {
      const res = await request("GET", "/v1/admin/users", undefined, authHeader(adminToken));
      expect(res.status).toBe(200);
    });
  });

  // --- RBAC Tests ---

  describe("RBAC", () => {
    test("admin can access admin-only endpoints", async () => {
      const res = await request("GET", "/v1/admin/users", undefined, authHeader(adminToken));
      expect(res.status).toBe(200);
    });

    test("publisher cannot access admin-only endpoints", async () => {
      const res = await request("GET", "/v1/admin/users", undefined, authHeader(publisherToken));
      expect(res.status).toBe(403);
    });

    test("reviewer cannot access admin-only endpoints", async () => {
      const res = await request("GET", "/v1/admin/users", undefined, authHeader(reviewerToken));
      expect(res.status).toBe(403);
    });

    test("admin can access publisher endpoints (role hierarchy)", async () => {
      const res = await request("GET", "/v1/admin/configs", undefined, authHeader(adminToken));
      expect(res.status).toBe(200);
    });

    test("publisher can access reviewer endpoints (role hierarchy)", async () => {
      // List configs is accessible to all authenticated users
      const res = await request("GET", "/v1/admin/configs", undefined, authHeader(publisherToken));
      expect(res.status).toBe(200);
    });
  });

  // --- User Management ---

  describe("User Management", () => {
    test("POST /v1/admin/users - admin creates user", async () => {
      const res = await request("POST", "/v1/admin/users", {
        username: "newuser",
        password: "newpassword-123",
        role: "reviewer",
      }, authHeader(adminToken));
      expect(res.status).toBe(201);

      const body = await res.json();
      expect(body.username).toBe("newuser");
      expect(body.role).toBe("reviewer");
      expect(body.id).toBeDefined();
    });

    test("POST /v1/admin/users - rejects short password", async () => {
      const res = await request("POST", "/v1/admin/users", {
        username: "shortpwuser",
        password: "short",
        role: "reviewer",
      }, authHeader(adminToken));
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toContain("12 characters");
    });

    test("POST /v1/admin/users - rejects duplicate username", async () => {
      const res = await request("POST", "/v1/admin/users", {
        username: "admin",
        password: "long-enough-password-123",
        role: "admin",
      }, authHeader(adminToken));
      expect(res.status).toBe(409);
    });

    test("POST /v1/admin/users - rejects invalid role", async () => {
      const res = await request("POST", "/v1/admin/users", {
        username: "baduser",
        password: "long-enough-password-123",
        role: "superadmin",
      }, authHeader(adminToken));
      expect(res.status).toBe(400);
    });

    test("GET /v1/admin/users - lists users", async () => {
      const res = await request("GET", "/v1/admin/users", undefined, authHeader(adminToken));
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body.length).toBeGreaterThanOrEqual(5);
      // Ensure password_hash is not exposed
      expect(body[0].password_hash).toBeUndefined();
    });
  });

  // --- Full Approval Workflow ---

  describe("Approval Workflow", () => {
    test("full workflow: create → submit → approve x2 → publish", async () => {
      // 1. Generate a signing key first
      const keyRes = await request("POST", "/v1/admin/keys", {}, authHeader(adminToken));
      expect(keyRes.status).toBe(201);
      const { key_id } = await keyRes.json();

      // 2. Publish a key list (root key from env)
      const { publicKey: rootPub, privateKey: rootPriv } = await generateKeyPair();
      process.env.ROOT_PRIVATE_KEY = uint8ArrayToBase64(rootPriv);

      const klRes = await request("POST", "/v1/admin/keys/publish-list", {}, authHeader(adminToken));
      expect(klRes.status).toBe(201);

      // 3. Publisher creates a draft config
      const createRes = await request("POST", "/v1/admin/configs", {
        changes: {
          features: { dark_mode: true },
          endpoints: { api: "https://api.example.com" },
        },
      }, authHeader(publisherToken));
      expect(createRes.status).toBe(201);
      const { version } = await createRes.json();

      // 4. View config detail
      const detailRes = await request("GET", `/v1/admin/configs/${version}`, undefined, authHeader(publisherToken));
      expect(detailRes.status).toBe(200);
      const detail = await detailRes.json();
      expect(detail.status).toBe("draft");

      // 5. Submit for review
      const submitRes = await request("POST", `/v1/admin/configs/${version}/submit`, {}, authHeader(publisherToken));
      expect(submitRes.status).toBe(200);
      const submitBody = await submitRes.json();
      expect(submitBody.status).toBe("pending_review");

      // 6. First reviewer approves
      const approve1Res = await request("POST", `/v1/admin/configs/${version}/approve`, {}, authHeader(reviewerToken));
      expect(approve1Res.status).toBe(200);
      const approve1Body = await approve1Res.json();
      expect(approve1Body.auto_approved).toBe(false);

      // 7. Second reviewer approves → auto-approved
      const approve2Res = await request("POST", `/v1/admin/configs/${version}/approve`, {}, authHeader(reviewer2Token));
      expect(approve2Res.status).toBe(200);
      const approve2Body = await approve2Res.json();
      expect(approve2Body.auto_approved).toBe(true);
      expect(approve2Body.status).toBe("approved");

      // 8. Publisher publishes the config
      const publishRes = await request("POST", `/v1/admin/configs/${version}/publish`, {
        key_id,
      }, authHeader(publisherToken));
      expect(publishRes.status).toBe(200);
      const publishBody = await publishRes.json();
      expect(publishBody.status).toBe("published");
      expect(publishBody.signature).toBeDefined();

      // 9. Verify published config is available via public API
      const publicRes = await request("GET", "/v1/config/latest");
      expect(publicRes.status).toBe(200);
      const publicBody = await publicRes.json();
      expect(publicBody.manifest.version).toBe(version);
    });

    test("rejection flow: create → submit → reject", async () => {
      // Create
      const createRes = await request("POST", "/v1/admin/configs", {
        changes: { features: { bad_feature: true } },
      }, authHeader(publisherToken));
      expect(createRes.status).toBe(201);
      const { version } = await createRes.json();

      // Submit
      await request("POST", `/v1/admin/configs/${version}/submit`, {}, authHeader(publisherToken));

      // Reject
      const rejectRes = await request("POST", `/v1/admin/configs/${version}/reject`, {
        comment: "This feature is not ready",
      }, authHeader(reviewerToken));
      expect(rejectRes.status).toBe(200);
      const rejectBody = await rejectRes.json();
      expect(rejectBody.status).toBe("rejected");

      // Verify status
      const detailRes = await request("GET", `/v1/admin/configs/${version}`, undefined, authHeader(publisherToken));
      const detail = await detailRes.json();
      expect(detail.status).toBe("rejected");
      expect(detail.approvals[0].decision).toBe("rejected");
      expect(detail.approvals[0].comment).toBe("This feature is not ready");
    });
  });

  // --- Edge Cases ---

  describe("Edge Cases", () => {
    test("cannot approve own config", async () => {
      // Publisher creates and submits
      const createRes = await request("POST", "/v1/admin/configs", {
        changes: { features: { test: true } },
      }, authHeader(publisherToken));
      const { version } = await createRes.json();

      await request("POST", `/v1/admin/configs/${version}/submit`, {}, authHeader(publisherToken));

      // Publisher tries to approve their own config (publisher has reviewer permissions)
      const approveRes = await request("POST", `/v1/admin/configs/${version}/approve`, {}, authHeader(publisherToken));
      expect(approveRes.status).toBe(400);
      const body = await approveRes.json();
      expect(body.error).toContain("Cannot approve your own config");
    });

    test("cannot edit non-draft config", async () => {
      // Create and submit
      const createRes = await request("POST", "/v1/admin/configs", {
        changes: { features: { edit_test: true } },
      }, authHeader(publisherToken));
      const { version } = await createRes.json();

      await request("POST", `/v1/admin/configs/${version}/submit`, {}, authHeader(publisherToken));

      // Try to edit pending_review config
      const editRes = await request("PUT", `/v1/admin/configs/${version}`, {
        changes: { features: { edit_test: false } },
      }, authHeader(publisherToken));
      expect(editRes.status).toBe(400);
      const body = await editRes.json();
      expect(body.error).toContain("draft");
    });

    test("cannot publish unapproved config", async () => {
      const createRes = await request("POST", "/v1/admin/configs", {
        changes: { features: { unapproved: true } },
      }, authHeader(publisherToken));
      const { version } = await createRes.json();

      const publishRes = await request("POST", `/v1/admin/configs/${version}/publish`, {
        key_id: "some-key",
      }, authHeader(publisherToken));
      expect(publishRes.status).toBe(400);
      const body = await publishRes.json();
      expect(body.error).toContain("approved");
    });

    test("cannot submit non-draft config", async () => {
      const createRes = await request("POST", "/v1/admin/configs", {
        changes: { features: { double_submit: true } },
      }, authHeader(publisherToken));
      const { version } = await createRes.json();

      // Submit once
      await request("POST", `/v1/admin/configs/${version}/submit`, {}, authHeader(publisherToken));

      // Submit again
      const submitRes = await request("POST", `/v1/admin/configs/${version}/submit`, {}, authHeader(publisherToken));
      expect(submitRes.status).toBe(400);
    });

    test("reviewer cannot approve same config twice", async () => {
      const createRes = await request("POST", "/v1/admin/configs", {
        changes: { features: { dup_approve: true } },
      }, authHeader(publisherToken));
      const { version } = await createRes.json();

      await request("POST", `/v1/admin/configs/${version}/submit`, {}, authHeader(publisherToken));

      // Approve once
      await request("POST", `/v1/admin/configs/${version}/approve`, {}, authHeader(reviewerToken));

      // Approve again
      const approveRes = await request("POST", `/v1/admin/configs/${version}/approve`, {}, authHeader(reviewerToken));
      expect(approveRes.status).toBe(400);
      const body = await approveRes.json();
      expect(body.error).toContain("Already reviewed");
    });

    test("config with base_version merges correctly", async () => {
      // Create first config
      const createRes1 = await request("POST", "/v1/admin/configs", {
        changes: {
          features: { a: true, b: false },
          endpoints: { api: "https://api.example.com" },
        },
      }, authHeader(publisherToken));
      const { version: v1 } = await createRes1.json();

      // Create based on first, changing only features
      const createRes2 = await request("POST", "/v1/admin/configs", {
        base_version: v1,
        changes: { features: { a: true, b: true, c: true } },
      }, authHeader(publisherToken));
      expect(createRes2.status).toBe(201);
      const { version: v2 } = await createRes2.json();

      // Verify merged content
      const detailRes = await request("GET", `/v1/admin/configs/${v2}`, undefined, authHeader(publisherToken));
      const detail = await detailRes.json();
      expect(detail.config_content.endpoints.api).toBe("https://api.example.com");
      expect(detail.config_content.features.c).toBe(true);
    });

    test("diff endpoint returns base and current", async () => {
      // Use configs already created
      const configs = await (await request("GET", "/v1/admin/configs", undefined, authHeader(publisherToken))).json();
      const withBase = configs.find((c: { base_version: number | null }) => c.base_version !== null);

      if (withBase) {
        const diffRes = await request("GET", `/v1/admin/configs/${withBase.version}/diff`, undefined, authHeader(publisherToken));
        expect(diffRes.status).toBe(200);
        const diff = await diffRes.json();
        expect(diff.current).toBeDefined();
        expect(diff.base).toBeDefined();
        expect(diff.base_version).toBe(withBase.base_version);
      }
    });

    test("reviewer cannot create configs", async () => {
      const res = await request("POST", "/v1/admin/configs", {
        changes: { features: { reviewer_create: true } },
      }, authHeader(reviewerToken));
      expect(res.status).toBe(403);
    });
  });

  // --- Key Management ---

  describe("Key Management", () => {
    test("admin can generate signing key", async () => {
      const res = await request("POST", "/v1/admin/keys", {}, authHeader(adminToken));
      expect(res.status).toBe(201);

      const body = await res.json();
      expect(body.key_id).toBeDefined();
      expect(body.public_key).toBeDefined();
    });

    test("admin can list signing keys", async () => {
      const res = await request("GET", "/v1/admin/keys", undefined, authHeader(adminToken));
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body.length).toBeGreaterThanOrEqual(1);
      // private_key_enc should not be exposed
      expect(body[0].private_key_enc).toBeUndefined();
    });

    test("admin can revoke a key", async () => {
      // Generate
      const genRes = await request("POST", "/v1/admin/keys", {}, authHeader(adminToken));
      const { key_id } = await genRes.json();

      // Revoke
      const revokeRes = await request("POST", `/v1/admin/keys/${key_id}/revoke`, {}, authHeader(adminToken));
      expect(revokeRes.status).toBe(200);
      const body = await revokeRes.json();
      expect(body.status).toBe("revoked");
    });

    test("cannot revoke already revoked key", async () => {
      const genRes = await request("POST", "/v1/admin/keys", {}, authHeader(adminToken));
      const { key_id } = await genRes.json();

      await request("POST", `/v1/admin/keys/${key_id}/revoke`, {}, authHeader(adminToken));
      const res = await request("POST", `/v1/admin/keys/${key_id}/revoke`, {}, authHeader(adminToken));
      expect(res.status).toBe(400);
    });

    test("publisher cannot manage keys", async () => {
      const res = await request("GET", "/v1/admin/keys", undefined, authHeader(publisherToken));
      expect(res.status).toBe(403);
    });

    test("admin can publish key list", async () => {
      const { privateKey } = await generateKeyPair();
      process.env.ROOT_PRIVATE_KEY = uint8ArrayToBase64(privateKey);

      const res = await request("POST", "/v1/admin/keys/publish-list", {}, authHeader(adminToken));
      expect(res.status).toBe(201);

      const body = await res.json();
      expect(body.list_sequence).toBeDefined();

      // Verify via public API
      const publicRes = await request("GET", "/v1/keys");
      expect(publicRes.status).toBe(200);
    });
  });
});
