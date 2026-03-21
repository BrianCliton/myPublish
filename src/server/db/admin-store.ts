import { Database } from "bun:sqlite";
import type { Config, KeyList } from "../../core/types.ts";
import { Store } from "./store.ts";

// --- Row types ---

export interface UserRow {
  readonly id: string;
  readonly username: string;
  readonly password_hash: string;
  readonly role: string;
  readonly created_at: number;
}

export interface ConfigDetailRow {
  readonly version: number;
  readonly config_content: string;
  readonly content_hash: string | null;
  readonly content_size: number | null;
  readonly author_id: string;
  readonly status: string;
  readonly base_version: number | null;
  readonly key_id: string | null;
  readonly signature: string | null;
  readonly expires_at: number | null;
  readonly created_at: number;
  readonly submitted_at: number | null;
  readonly approved_at: number | null;
  readonly published_at: number | null;
}

export interface ApprovalRow {
  readonly id: string;
  readonly config_ver: number;
  readonly reviewer_id: string;
  readonly decision: string;
  readonly comment: string | null;
  readonly created_at: number;
}

export interface SigningKeyRow {
  readonly key_id: string;
  readonly public_key: string;
  readonly private_key_enc: string;
  readonly status: string;
  readonly not_before: number;
  readonly not_after: number;
  readonly created_at: number;
  readonly revoked_at: number | null;
}

export class AdminStore extends Store {
  // --- Users ---

  createUser(id: string, username: string, passwordHash: string, role: string): void {
    this.db.run(
      `INSERT INTO users (id, username, password_hash, role) VALUES (?, ?, ?, ?)`,
      [id, username, passwordHash, role],
    );
  }

  getUserById(id: string): UserRow | null {
    return this.db
      .query<UserRow, [string]>(`SELECT * FROM users WHERE id = ?`)
      .get(id);
  }

  getUserByUsername(username: string): UserRow | null {
    return this.db
      .query<UserRow, [string]>(`SELECT * FROM users WHERE username = ?`)
      .get(username);
  }

  listUsers(): readonly UserRow[] {
    return this.db.query<UserRow, []>(`SELECT * FROM users ORDER BY created_at`).all();
  }

  // --- Configs ---

  getNextConfigVersion(): number {
    const row = this.db
      .query<{ max_ver: number | null }, []>(`SELECT MAX(version) as max_ver FROM configs`)
      .get();
    return (row?.max_ver ?? 0) + 1;
  }

  createConfig(
    version: number,
    configContent: string,
    authorId: string,
    baseVersion: number | null,
  ): void {
    this.db.run(
      `INSERT INTO configs (version, config_content, author_id, status, base_version)
       VALUES (?, ?, ?, 'draft', ?)`,
      [version, configContent, authorId, baseVersion],
    );
  }

  getConfigDetail(version: number): ConfigDetailRow | null {
    return this.db
      .query<ConfigDetailRow, [number]>(`SELECT * FROM configs WHERE version = ?`)
      .get(version);
  }

  listConfigs(): readonly ConfigDetailRow[] {
    return this.db
      .query<ConfigDetailRow, []>(`SELECT * FROM configs ORDER BY version DESC`)
      .all();
  }

  updateConfigContent(version: number, configContent: string): void {
    this.db.run(
      `UPDATE configs SET config_content = ? WHERE version = ? AND status = 'draft'`,
      [configContent, version],
    );
  }

  private static readonly ALLOWED_EXTRA_FIELDS = new Set([
    "submitted_at", "approved_at", "published_at",
    "content_hash", "content_size", "key_id",
    "signature", "expires_at", "config_content",
  ]);

  updateConfigStatus(version: number, status: string, extraFields?: Record<string, unknown>): void {
    if (extraFields && Object.keys(extraFields).length > 0) {
      const setClauses = [`status = ?`];
      const params: unknown[] = [status];
      for (const [key, value] of Object.entries(extraFields)) {
        if (!AdminStore.ALLOWED_EXTRA_FIELDS.has(key)) {
          throw new Error(`Disallowed field name: ${key}`);
        }
        setClauses.push(`${key} = ?`);
        params.push(value);
      }
      params.push(version);
      this.db.run(
        `UPDATE configs SET ${setClauses.join(", ")} WHERE version = ?`,
        params,
      );
    } else {
      this.db.run(`UPDATE configs SET status = ? WHERE version = ?`, [status, version]);
    }
  }

  // --- Approvals ---

  createApproval(id: string, configVer: number, reviewerId: string, decision: string, comment: string | null): void {
    this.db.run(
      `INSERT INTO approvals (id, config_ver, reviewer_id, decision, comment) VALUES (?, ?, ?, ?, ?)`,
      [id, configVer, reviewerId, decision, comment],
    );
  }

  getApprovalsByVersion(configVer: number): readonly ApprovalRow[] {
    return this.db
      .query<ApprovalRow, [number]>(`SELECT * FROM approvals WHERE config_ver = ? ORDER BY created_at`)
      .all(configVer);
  }

  getApprovalByReviewer(configVer: number, reviewerId: string): ApprovalRow | null {
    return this.db
      .query<ApprovalRow, [number, string]>(
        `SELECT * FROM approvals WHERE config_ver = ? AND reviewer_id = ?`,
      )
      .get(configVer, reviewerId);
  }

  countApprovals(configVer: number): number {
    const row = this.db
      .query<{ cnt: number }, [number]>(
        `SELECT COUNT(*) as cnt FROM approvals WHERE config_ver = ? AND decision = 'approved'`,
      )
      .get(configVer);
    return row?.cnt ?? 0;
  }

  // --- Signing Keys ---

  createSigningKey(
    keyId: string,
    publicKey: string,
    privateKeyEnc: string,
    notBefore: number,
    notAfter: number,
  ): void {
    this.db.run(
      `INSERT INTO signing_keys (key_id, public_key, private_key_enc, status, not_before, not_after)
       VALUES (?, ?, ?, 'active', ?, ?)`,
      [keyId, publicKey, privateKeyEnc, notBefore, notAfter],
    );
  }

  getSigningKey(keyId: string): SigningKeyRow | null {
    return this.db
      .query<SigningKeyRow, [string]>(`SELECT * FROM signing_keys WHERE key_id = ?`)
      .get(keyId);
  }

  listSigningKeys(): readonly SigningKeyRow[] {
    return this.db
      .query<SigningKeyRow, []>(`SELECT * FROM signing_keys ORDER BY created_at`)
      .all();
  }

  revokeSigningKey(keyId: string): void {
    const now = Math.floor(Date.now() / 1000);
    this.db.run(
      `UPDATE signing_keys SET status = 'revoked', revoked_at = ? WHERE key_id = ?`,
      [now, keyId],
    );
  }

  listActiveSigningKeys(): readonly SigningKeyRow[] {
    return this.db
      .query<SigningKeyRow, []>(
        `SELECT * FROM signing_keys WHERE status = 'active' ORDER BY created_at`,
      )
      .all();
  }

  // --- Key Lists ---

  getNextKeyListSequence(): number {
    const row = this.db
      .query<{ max_seq: number | null }, []>(
        `SELECT MAX(list_sequence) as max_seq FROM key_lists`,
      )
      .get();
    return (row?.max_seq ?? 0) + 1;
  }

  insertKeyList(listSequence: number, content: string, rootSignature: string): void {
    this.db.run(
      `INSERT INTO key_lists (list_sequence, content, root_signature) VALUES (?, ?, ?)`,
      [listSequence, content, rootSignature],
    );
  }
}
