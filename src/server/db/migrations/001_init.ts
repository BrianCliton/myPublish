import { Database } from "bun:sqlite";
import { SCHEMA_SQL } from "../schema.ts";

export function migrate001Init(db: Database): void {
  db.exec(SCHEMA_SQL);
}
