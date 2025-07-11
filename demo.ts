//@ts-nocheck
/// <reference types="@cloudflare/workers-types" />

import { DurableObject } from "cloudflare:workers";
import { Migratable } from "./migratable-object";

@Migratable({
  migrations: {
    "1": [
      `CREATE TABLE items (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)`,
    ],
  },
})
export class ItemsStore extends DurableObject {
  sql: SqlStorage;
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
      // Get the Durable Object instance
      const id = env.ITEMS_STORE.idFromName("root");
      const obj = env.ITEMS_STORE.get(id);
      const result = await obj.addAndGetCount(`Item ${Date.now()}`);
      return new Response(`Item added successfully. Total items: ${result}`);
    } catch (error) {
      return new Response(
        error instanceof Error ? error.message : "Unknown error",
        { status: 500 },
      );
    }
  },
};
