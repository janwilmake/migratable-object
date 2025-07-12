//@ts-nocheck
/// <reference types="@cloudflare/workers-types" />

import { DurableObject } from "cloudflare:workers";
import { Migratable, MigratableObject } from "./migratable-object";

@Migratable({
  migrations: {
    "1": [
      `CREATE TABLE items (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)`,
    ],
    "2": [`CREATE TABLE items2 (name TEXT, description TEXT)`],
  },
})
export class ItemsStore extends DurableObject {
  sql: SqlStorage;
  latestMigrationError: string | null;

  constructor(state: DurableObjectState, env: any) {
    super(state, env);
    this.sql = state.storage.sql;
  }

  async addAndGetCount(name: string): Promise<number> {
    this.sql.exec("INSERT INTO items (name) VALUES (?)", name);
    const cursor = this.sql.exec("SELECT COUNT(*) as count FROM items");
    const result = cursor.toArray()[0] as { count: number };
    return result.count;
  }
}
type Env = { ITEMS_STORE: DurableObjectNamespace<ItemsStore> };
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    try {
      const stub = env.ITEMS_STORE.get(env.ITEMS_STORE.idFromName("v1"));
      const result = await stub.addAndGetCount(`Item ${Date.now()}`);
      return new Response(`Item added successfully. Total items: ${result}`);
    } catch (error) {
      return new Response(
        error instanceof Error ? "DO error: " + error.message : "Unknown error",
        { status: 500 },
      );
    }
  },
};
