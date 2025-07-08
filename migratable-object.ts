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

export interface MigratableHandler {
  migrate(): Promise<MigrationResult[]>;
}

export type MigrateFn = () => Promise<MigrationResult[]>;

interface MigrationRow extends Record<string, any> {
  version: string;
}

export class MigratableHandlerImpl implements MigratableHandler {
  public sql: SqlStorage | undefined;
  public env: any;
  private currentVersion: number = 0;
  private id: string | undefined;
  private migrations: Record<string, string[]>;

  constructor(
    sql: SqlStorage | undefined,
    id?: string,
    env?: any,
    options?: MigratableOptions,
  ) {
    this.sql = sql;
    this.env = env;
    this.id = id;
    this.migrations = options?.migrations || {};

    // Initialize migrations table and load current version
    if (this.sql) {
      this.initializeMigrations();
    }
  }

  /**
   * Initialize the _migrations table and load the current version into memory
   */
  private initializeMigrations(): void {
    if (!this.sql) return;

    try {
      // Create _migrations table if it doesn't exist
      this.sql.exec(`
        CREATE TABLE IF NOT EXISTS _migrations (
          version TEXT PRIMARY KEY,
          applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          errors TEXT DEFAULT NULL
        )
      `);

      // Get the current version (latest successfully applied migration)
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

  /**
   * Apply migrations if newer versions are available
   */
  async migrate(): Promise<MigrationResult[]> {
    if (!this.sql) return [];

    const results: MigrationResult[] = [];

    // Sort version keys to ensure proper order
    const versionKeys = Object.keys(this.migrations)
      .map((version) => Number(version))
      .filter((version) => !isNaN(version))
      .sort((a, b) => a - b);

    // Filter out versions that are already applied
    const newVersions = versionKeys.filter(
      (version) => version > (this.currentVersion || 0),
    );

    if (newVersions.length === 0) {
      return results;
    }

    for (const version of newVersions) {
      const migrationQueries = this.migrations[version.toString()];
      const versionErrors: string[] = [];
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
          versionErrors.push(`Query failed: ${query}. Error: ${errorMessage}`);

          results.push({
            version,
            query,
            success: false,
            error: errorMessage,
          });

          console.error(`Migration ${version} failed on query:`, query, error);
          versionSuccess = false;

          // Record the failed migration attempt with errors
          this.sql.exec(
            `INSERT INTO _migrations (version, errors) VALUES (?, ?)`,
            version.toString(),
            JSON.stringify(versionErrors),
          );

          // Stop applying migrations on error
          throw new Error(`Migration ${version} failed: ${errorMessage}`);
        }
      }

      if (versionSuccess) {
        // Record the successful migration
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
      public _migratableHandler?: MigratableHandlerImpl;
      private _migratableOptions: MigratableOptions;

      constructor(...args: any[]) {
        super(...args);
        this._migratableOptions = options;
      }

      async migrate(): Promise<MigrationResult[]> {
        // Initialize handler if not already done
        if (!this._migratableHandler) {
          this._migratableHandler = new MigratableHandlerImpl(
            this.sql,
            this.ctx?.id?.toString(),
            this.env,
            this._migratableOptions,
          );
        }

        return await this._migratableHandler.migrate();
      }
    };
  };
}

export class MigratableObject<TEnv = any> extends DurableObject<TEnv> {
  public sql: SqlStorage | undefined;
  protected _migratableHandler?: MigratableHandlerImpl;
  protected readonly options?: MigratableOptions;

  constructor(
    state: DurableObjectState,
    env: TEnv,
    options?: MigratableOptions,
  ) {
    super(state, env);
    this.sql = state.storage.sql;
    this.options = options;
  }

  async migrate(): Promise<MigrationResult[]> {
    if (!this._migratableHandler) {
      this._migratableHandler = new MigratableHandlerImpl(
        this.sql,
        this.ctx.id.toString(),
        this.env,
        this.options,
      );
    }

    return await this._migratableHandler.migrate();
  }
}
