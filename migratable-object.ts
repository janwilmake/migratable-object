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
    const invalidVersions = Object.keys(migrations).filter((version) =>
      isNaN(Number(version)),
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

    // Get all successfully applied migrations

    const appliedVersions = new Set(
      execFn<MigrationRow>(`
      SELECT version FROM _migrations 
      WHERE errors IS NULL
    `)
        .toArray()
        .map((row) => Number(row.version)),
    );

    // Get pending migrations - only run migrations that haven't been applied
    const versionKeys = Object.keys(migrations)
      .map(Number)
      .filter((version) => !isNaN(version) && !appliedVersions.has(version))
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
            `INSERT OR REPLACE INTO _migrations (version, errors) VALUES (?, ?)`,
            version.toString(),
            errorMessage,
          );

          const fullError = `Migration ${version} failed\n\n${
            migrationQueries.length > 1
              ? `Queries:\n"""\n${migrationQueries.join("\n")}\n"""\n\n`
              : ""
          }Erroneous Query:\n"""\n${query}\n"""\n\nERROR:\n"""\n${errorMessage}\n"""\n\n`;
          return fullError;
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

        const error = runMigrations(
          this.ctx.storage.sql.exec.bind(this.ctx.storage.sql),
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

    const error = runMigrations(
      state.storage.sql.exec.bind(state.storage.sql),
      options.migrations,
    );
    if (error) {
      console.error("Migration failed:", error);
      throw new Error(error);
    }
  }
}
