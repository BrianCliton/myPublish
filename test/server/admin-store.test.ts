import { describe, test, expect, beforeEach, afterEach } from "bun:test";

process.env.NODE_ENV = "test";

import { AdminStore } from "../../src/server/db/admin-store.ts";

describe("AdminStore", () => {
  let store: AdminStore;

  beforeEach(() => {
    store = new AdminStore(":memory:");
    store.runMigrations();
  });

  afterEach(() => {
    store.close();
  });

  describe("Users", () => {
    test("createUser and getUserById", () => {
      store.createUser("u1", "alice", "hash123", "admin");
      const user = store.getUserById("u1");
      expect(user).not.toBeNull();
      expect(user!.username).toBe("alice");
      expect(user!.role).toBe("admin");
    });

    test("getUserByUsername", () => {
      store.createUser("u1", "alice", "hash123", "admin");
      const user = store.getUserByUsername("alice");
      expect(user).not.toBeNull();
      expect(user!.id).toBe("u1");
    });

    test("getUserById returns null for missing user", () => {
      expect(store.getUserById("nonexistent")).toBeNull();
    });

    test("getUserByUsername returns null for missing user", () => {
      expect(store.getUserByUsername("nonexistent")).toBeNull();
    });

    test("listUsers returns all users sorted by created_at", () => {
      store.createUser("u1", "alice", "hash", "admin");
      store.createUser("u2", "bob", "hash", "publisher");
      store.createUser("u3", "carol", "hash", "reviewer");
      const users = store.listUsers();
      expect(users).toHaveLength(3);
      expect(users[0].username).toBe("alice");
    });
  });

  describe("Configs", () => {
    beforeEach(() => {
      store.createUser("u1", "author", "hash", "publisher");
    });

    test("getNextConfigVersion starts at 1", () => {
      expect(store.getNextConfigVersion()).toBe(1);
    });

    test("getNextConfigVersion increments", () => {
      store.createConfig(1, '{"features":{}}', "u1", null);
      expect(store.getNextConfigVersion()).toBe(2);
    });

    test("createConfig and getConfigDetail", () => {
      store.createConfig(1, '{"features":{"dark_mode":true}}', "u1", null);
      const config = store.getConfigDetail(1);
      expect(config).not.toBeNull();
      expect(config!.status).toBe("draft");
      expect(config!.author_id).toBe("u1");
      expect(config!.base_version).toBeNull();
    });

    test("createConfig with base_version", () => {
      store.createConfig(1, '{"features":{}}', "u1", null);
      store.createConfig(2, '{"features":{"new":true}}', "u1", 1);
      const config = store.getConfigDetail(2);
      expect(config!.base_version).toBe(1);
    });

    test("getConfigDetail returns null for missing version", () => {
      expect(store.getConfigDetail(999)).toBeNull();
    });

    test("listConfigs returns configs in descending version order", () => {
      store.createConfig(1, '{}', "u1", null);
      store.createConfig(2, '{}', "u1", 1);
      const configs = store.listConfigs();
      expect(configs).toHaveLength(2);
      expect(configs[0].version).toBe(2);
      expect(configs[1].version).toBe(1);
    });

    test("updateConfigContent updates draft content", () => {
      store.createConfig(1, '{"old":true}', "u1", null);
      store.updateConfigContent(1, '{"new":true}');
      const config = store.getConfigDetail(1);
      expect(config!.config_content).toBe('{"new":true}');
    });

    test("updateConfigStatus without extra fields", () => {
      store.createConfig(1, '{}', "u1", null);
      store.updateConfigStatus(1, "pending_review");
      const config = store.getConfigDetail(1);
      expect(config!.status).toBe("pending_review");
    });

    test("updateConfigStatus with extra fields", () => {
      store.createConfig(1, '{}', "u1", null);
      store.updateConfigStatus(1, "published", {
        content_hash: "sha256:abc",
        published_at: 1234567890,
      });
      const config = store.getConfigDetail(1);
      expect(config!.status).toBe("published");
      expect(config!.content_hash).toBe("sha256:abc");
      expect(config!.published_at).toBe(1234567890);
    });
  });

  describe("Approvals", () => {
    beforeEach(() => {
      store.createUser("u1", "author", "hash", "publisher");
      store.createUser("u2", "reviewer1", "hash", "reviewer");
      store.createConfig(1, '{}', "u1", null);
    });

    test("createApproval and getApprovalsByVersion", () => {
      store.createApproval("a1", 1, "u2", "approved", null);
      const approvals = store.getApprovalsByVersion(1);
      expect(approvals).toHaveLength(1);
      expect(approvals[0].reviewer_id).toBe("u2");
      expect(approvals[0].decision).toBe("approved");
    });

    test("getApprovalByReviewer", () => {
      store.createApproval("a1", 1, "u2", "approved", "looks good");
      const approval = store.getApprovalByReviewer(1, "u2");
      expect(approval).not.toBeNull();
      expect(approval!.comment).toBe("looks good");
    });

    test("getApprovalByReviewer returns null for no review", () => {
      expect(store.getApprovalByReviewer(1, "u2")).toBeNull();
    });

    test("countApprovals counts only approved decisions", () => {
      store.createUser("u3", "reviewer2", "hash", "reviewer");
      store.createApproval("a1", 1, "u2", "approved", null);
      store.createApproval("a2", 1, "u3", "rejected", "nope");
      expect(store.countApprovals(1)).toBe(1);
    });
  });

  describe("Signing Keys", () => {
    const now = Math.floor(Date.now() / 1000);

    test("createSigningKey and getSigningKey", () => {
      store.createSigningKey("k1", "pubkey", "encprivkey", now, now + 86400);
      const key = store.getSigningKey("k1");
      expect(key).not.toBeNull();
      expect(key!.public_key).toBe("pubkey");
      expect(key!.status).toBe("active");
    });

    test("getSigningKey returns null for missing key", () => {
      expect(store.getSigningKey("nonexistent")).toBeNull();
    });

    test("listSigningKeys", () => {
      store.createSigningKey("k1", "pub1", "enc1", now, now + 86400);
      store.createSigningKey("k2", "pub2", "enc2", now, now + 86400);
      const keys = store.listSigningKeys();
      expect(keys).toHaveLength(2);
    });

    test("revokeSigningKey", () => {
      store.createSigningKey("k1", "pub1", "enc1", now, now + 86400);
      store.revokeSigningKey("k1");
      const key = store.getSigningKey("k1");
      expect(key!.status).toBe("revoked");
      expect(key!.revoked_at).toBeGreaterThan(0);
    });

    test("listActiveSigningKeys excludes revoked", () => {
      store.createSigningKey("k1", "pub1", "enc1", now, now + 86400);
      store.createSigningKey("k2", "pub2", "enc2", now, now + 86400);
      store.revokeSigningKey("k1");
      const active = store.listActiveSigningKeys();
      expect(active).toHaveLength(1);
      expect(active[0].key_id).toBe("k2");
    });
  });

  describe("Key Lists", () => {
    test("getNextKeyListSequence starts at 1", () => {
      expect(store.getNextKeyListSequence()).toBe(1);
    });

    test("getNextKeyListSequence increments", () => {
      store.insertKeyList(1, '{"keys":[]}', "sig1");
      expect(store.getNextKeyListSequence()).toBe(2);
    });

    test("insertKeyList and getLatestKeyList", () => {
      store.insertKeyList(1, '{"version":1,"list_sequence":1,"timestamp":1000,"expires_at":2000,"keys":[]}', "sig1");
      const kl = store.getLatestKeyList();
      expect(kl).not.toBeNull();
      expect(kl!.root_signature).toBe("sig1");
    });
  });
});
