import { Database } from "bun:sqlite";
import type { Config, KeyList, Manifest } from "../../core/types.ts";
import { migrate001Init } from "./migrations/001_init.ts";

export interface PublishedConfig {
  readonly manifest: Manifest;
  readonly config: Config;
}

interface ConfigRow {
  readonly version: number;
  readonly config_content: string;
  readonly content_hash: string;
  readonly content_size: number;
  readonly key_id: string;
  readonly signature: string;
  readonly expires_at: number;
  readonly published_at: number;
}

interface KeyListRow {
  readonly list_sequence: number;
  readonly content: string;
  readonly root_signature: string;
}

export class Store {
  private readonly _db: Database;

  constructor(dbPath: string = ":memory:") {
    this._db = new Database(dbPath);
    this._db.exec("PRAGMA journal_mode=WAL;");
    this._db.exec("PRAGMA foreign_keys=ON;");
  }

  /** Expose raw DB handle for test seeding only. */
  get db(): Database {
    return this._db;
  }

  runMigrations(): void {
    migrate001Init(this._db);
  }

  getLatestPublishedConfig(): PublishedConfig | null {
    const row = this._db
      .query<ConfigRow, []>(
        `SELECT version, config_content, content_hash, content_size,
                key_id, signature, expires_at, published_at
         FROM configs
         WHERE status = 'published'
         ORDER BY version DESC
         LIMIT 1`
      )
      .get();

    if (!row) return null;

    return this.rowToPublishedConfig(row);
  }

  getConfigByVersion(version: number): PublishedConfig | null {
    const row = this._db
      .query<ConfigRow, [number]>(
        `SELECT version, config_content, content_hash, content_size,
                key_id, signature, expires_at, published_at
         FROM configs
         WHERE version = ? AND status = 'published'`
      )
      .get(version);

    if (!row) return null;

    return this.rowToPublishedConfig(row);
  }

  getLatestKeyList(): KeyList | null {
    const row = this._db
      .query<KeyListRow, []>(
        `SELECT list_sequence, content, root_signature
         FROM key_lists
         ORDER BY list_sequence DESC
         LIMIT 1`
      )
      .get();

    if (!row) return null;

    const parsed = this.parseJson<Omit<KeyList, "root_signature">>(row.content, "key_lists.content");
    return {
      ...parsed,
      root_signature: row.root_signature,
    };
  }

  close(): void {
    this._db.close();
  }

  private rowToPublishedConfig(row: ConfigRow): PublishedConfig {
    const config = this.parseJson<Config>(row.config_content, "configs.config_content");

    const manifest: Manifest = {
      version: row.version,
      content_hash: row.content_hash,
      content_size: row.content_size,
      key_id: row.key_id,
      timestamp: row.published_at,
      expires_at: row.expires_at,
      signature: row.signature,
    };

    return { manifest, config };
  }

  private parseJson<T>(raw: string, context: string): T {
    try {
      return JSON.parse(raw) as T;
    } catch {
      throw new Error(`Corrupt data in ${context}: invalid JSON`);
    }
  }
}
