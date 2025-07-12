/// <reference types="@cloudflare/workers-types" />
/// <reference lib="esnext" />

import { DurableObject } from "cloudflare:workers";

export interface MigratableOptions {
  migrations: Record<string, string[]>;
}

interface MigrationRow extends Record<string, any> {
  version: string;
}

export function runMigrations(
  execFn: SqlStorage["exec"],
  migrations: Record<string, string[]>,
): string | null {
  try {
    if (!migrations) {
      throw new Error("Migrations were not provided");
    }
    const invalidVersions = Object.keys(migrations).filter(
      (version) => !isNaN(Number(version)),
    );

    if (invalidVersions.length > 0) {
      throw new Error(
        "Migration version keys must be numeric. Not numeric: " +
          invalidVersions.join(","),
      );
    }

    // Initialize migrations table
    execFn(`
      CREATE TABLE IF NOT EXISTS _migrations (
        version TEXT PRIMARY KEY,
        applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        errors TEXT DEFAULT NULL
      )
    `);

    // Get current version
    const cursor = execFn(`
      SELECT version FROM _migrations 
      WHERE errors IS NULL
      ORDER BY applied_at DESC 
      LIMIT 1
    `);

    const rows = cursor.toArray() as MigrationRow[];
    const currentVersion = rows[0] ? Number(rows[0].version) : 0;

    // Get pending migrations
    const versionKeys = Object.keys(migrations)
      .map(Number)
      .filter((version) => !isNaN(version) && version > currentVersion)
      .sort((a, b) => a - b);

    // Run pending migrations
    for (const version of versionKeys) {
      const migrationQueries = migrations[version.toString()];

      for (const query of migrationQueries) {
        try {
          execFn(query);
        } catch (error) {
          const errorMessage =
            error instanceof Error ? error.message : String(error);

          execFn(
            `INSERT INTO _migrations (version, errors) VALUES (?, ?)`,
            version.toString(),
            errorMessage,
          );

          return `Migration ${version} failed: ${errorMessage}`;
        }
      }

      // Mark migration as successful
      execFn(
        `INSERT OR REPLACE INTO _migrations (version) VALUES (?)`,
        version.toString(),
      );
    }

    return null; // No errors
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    return `Migration initialization failed: ${errorMessage}`;
  }
}

export function Migratable(options: MigratableOptions) {
  return function <T extends { new (...args: any[]): any }>(constructor: T) {
    return class extends constructor {
      constructor(...args: any[]) {
        super(...args);

        if (!this.sql) {
          throw new Error("Migratable Object must have access to this.sql");
        }

        const error = runMigrations(
          this.sql.exec.bind(this.sql),
          options.migrations,
        );
        if (error) {
          console.error("Migration failed:", error);
          throw new Error(error);
        }
      }
    };
  };
}

export class MigratableObject<TEnv = any> extends DurableObject<TEnv> {
  constructor(
    state: DurableObjectState,
    env: TEnv,
    options: MigratableOptions,
  ) {
    super(state, env);

    state.blockConcurrencyWhile(async () => {
      const error = runMigrations(
        state.storage.sql.exec.bind(state.storage.sql),
        options.migrations,
      );
      if (error) {
        throw new Error(error);
      }
    });
  }
}
