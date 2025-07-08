/// <reference types="@cloudflare/workers-types" />
/// <reference lib="esnext" />

import { DurableObject } from "cloudflare:workers";

export interface MigrationResult {
  version: number;
  query: string;
  success: boolean;
  rowsRead?: number;
  rowsWritten?: number;
  error?: string;
}

export interface MigratableOptions {
  migrations: Record<string, string[]>;
}

interface MigrationRow extends Record<string, any> {
  version: string;
}

class MigrationRunner {
  private sql: SqlStorage;
  private currentVersion: number = 0;
  private migrations: Record<string, string[]>;

  constructor(sql: SqlStorage, migrations: Record<string, string[]>) {
    this.sql = sql;
    this.migrations = migrations;
    this.initializeMigrations();
  }

  private initializeMigrations(): void {
    try {
      this.sql.exec(`
        CREATE TABLE IF NOT EXISTS _migrations (
          version TEXT PRIMARY KEY,
          applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          errors TEXT DEFAULT NULL
        )
      `);

      const cursor = this.sql.exec(`
        SELECT version FROM _migrations 
        WHERE errors IS NULL
        ORDER BY applied_at DESC 
        LIMIT 1
      `);

      const rows = cursor.toArray() as MigrationRow[];
      const row = rows[0];

      if (row) {
        this.currentVersion = Number(row.version);
      }
    } catch (error) {
      console.error("Failed to initialize migrations:", error);
    }
  }

  async migrate(): Promise<MigrationResult[]> {
    const results: MigrationResult[] = [];

    const versionKeys = Object.keys(this.migrations)
      .map((version) => Number(version))
      .filter((version) => !isNaN(version))
      .sort((a, b) => a - b);

    const newVersions = versionKeys.filter(
      (version) => version > this.currentVersion,
    );

    if (newVersions.length === 0) {
      return results;
    }

    for (const version of newVersions) {
      const migrationQueries = this.migrations[version.toString()];
      let versionSuccess = true;

      for (const query of migrationQueries) {
        try {
          const cursor = this.sql.exec(query);
          results.push({
            version,
            query,
            success: true,
            rowsRead: cursor.rowsRead,
            rowsWritten: cursor.rowsWritten,
          });
        } catch (error) {
          const errorMessage =
            error instanceof Error ? error.message : String(error);

          results.push({
            version,
            query,
            success: false,
            error: errorMessage,
          });

          this.sql.exec(
            `INSERT INTO _migrations (version, errors) VALUES (?, ?)`,
            version.toString(),
            errorMessage,
          );

          throw new Error(`Migration ${version} failed: ${errorMessage}`);
        }
      }

      if (versionSuccess) {
        this.sql.exec(
          `INSERT INTO _migrations (version) VALUES (?)`,
          version.toString(),
        );
        this.currentVersion = version;
      }
    }

    return results;
  }
}

export function Migratable(options: MigratableOptions) {
  return function <T extends { new (...args: any[]): any }>(constructor: T) {
    return class extends constructor {
      constructor(...args: any[]) {
        super(...args);

        // Auto-migrate in constructor
        if (this.sql) {
          const runner = new MigrationRunner(this.sql, options.migrations);
          runner.migrate().catch((error) => {
            console.error("Migration failed:", error);
            throw error;
          });
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
      const runner = new MigrationRunner(state.storage.sql, options.migrations);
      await runner.migrate();
    });
  }
}
