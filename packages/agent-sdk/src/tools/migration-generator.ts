import { createLogger } from "@prometheus/logger";

const logger = createLogger("agent-sdk:migration-generator");

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SchemaSnapshot {
  columns: ColumnDef[];
  indexes: IndexDef[];
  tableName: string;
}

export interface ColumnDef {
  defaultValue?: string;
  name: string;
  nullable: boolean;
  type: string;
}

export interface IndexDef {
  columns: string[];
  name: string;
  unique: boolean;
}

export interface GeneratedMigration {
  downSql: string;
  estimatedDowntime: boolean;
  fileName: string;
  upSql: string;
}

export interface MigrationValidation {
  errors: string[];
  valid: boolean;
  warnings: string[];
}

// ---------------------------------------------------------------------------
// MigrationGenerator
// ---------------------------------------------------------------------------

/**
 * Generates Drizzle-compatible database migrations by diffing schema snapshots.
 * Supports rollback generation and safety validation.
 */
export class MigrationGenerator {
  /**
   * Generate a migration by comparing before and after schema snapshots.
   */
  generateFromSchemaChange(
    before: SchemaSnapshot[],
    after: SchemaSnapshot[]
  ): GeneratedMigration {
    logger.info("Generating migration from schema change");

    const upStatements: string[] = [];
    const downStatements: string[] = [];

    const beforeMap = new Map(before.map((t) => [t.tableName, t]));
    const afterMap = new Map(after.map((t) => [t.tableName, t]));

    this.detectNewTables(afterMap, beforeMap, upStatements, downStatements);
    this.detectRemovedTables(beforeMap, afterMap, upStatements, downStatements);
    this.detectColumnChanges(afterMap, beforeMap, upStatements, downStatements);

    const timestamp = new Date()
      .toISOString()
      .replaceAll(/[-:T.Z]/g, "")
      .slice(0, 14);

    return {
      fileName: `${timestamp}_migration.sql`,
      upSql: upStatements.join("\n"),
      downSql: downStatements.join("\n"),
      estimatedDowntime: this.estimateDowntime(upStatements.join("\n")),
    };
  }

  private detectNewTables(
    afterMap: Map<string, SchemaSnapshot>,
    beforeMap: Map<string, SchemaSnapshot>,
    upStatements: string[],
    downStatements: string[]
  ): void {
    for (const [name, table] of afterMap) {
      if (!beforeMap.has(name)) {
        upStatements.push(this.generateCreateTable(table));
        downStatements.push(`DROP TABLE IF EXISTS "${name}";`);
      }
    }
  }

  private detectRemovedTables(
    beforeMap: Map<string, SchemaSnapshot>,
    afterMap: Map<string, SchemaSnapshot>,
    upStatements: string[],
    downStatements: string[]
  ): void {
    for (const [name, table] of beforeMap) {
      if (!afterMap.has(name)) {
        upStatements.push(`DROP TABLE IF EXISTS "${name}";`);
        downStatements.push(this.generateCreateTable(table));
      }
    }
  }

  private detectColumnChanges(
    afterMap: Map<string, SchemaSnapshot>,
    beforeMap: Map<string, SchemaSnapshot>,
    upStatements: string[],
    downStatements: string[]
  ): void {
    for (const [name, afterTable] of afterMap) {
      const beforeTable = beforeMap.get(name);
      if (!beforeTable) {
        continue;
      }
      const beforeCols = new Map(beforeTable.columns.map((c) => [c.name, c]));
      const afterCols = new Map(afterTable.columns.map((c) => [c.name, c]));

      for (const [colName, col] of afterCols) {
        if (!beforeCols.has(colName)) {
          upStatements.push(this.generateAddColumn(name, colName, col));
          downStatements.push(
            `ALTER TABLE "${name}" DROP COLUMN IF EXISTS "${colName}";`
          );
        }
      }
      for (const [colName, col] of beforeCols) {
        if (!afterCols.has(colName)) {
          upStatements.push(
            `ALTER TABLE "${name}" DROP COLUMN IF EXISTS "${colName}";`
          );
          downStatements.push(this.generateAddColumn(name, colName, col));
        }
      }
    }
  }

  private generateAddColumn(
    tableName: string,
    colName: string,
    col: { type: string; nullable: boolean; defaultValue?: string }
  ): string {
    return `ALTER TABLE "${tableName}" ADD COLUMN "${colName}" ${col.type}${col.nullable ? "" : " NOT NULL"}${col.defaultValue ? ` DEFAULT ${col.defaultValue}` : ""};`;
  }

  /**
   * Generate a rollback migration from an existing migration.
   */
  generateRollback(migration: GeneratedMigration): GeneratedMigration {
    logger.info(
      { originalFile: migration.fileName },
      "Generating rollback migration"
    );

    return {
      fileName: migration.fileName.replace(".sql", "_rollback.sql"),
      upSql: migration.downSql,
      downSql: migration.upSql,
      estimatedDowntime: migration.estimatedDowntime,
    };
  }

  /**
   * Validate a migration for common safety issues.
   */
  validateMigration(sql: string): MigrationValidation {
    logger.info("Validating migration");

    const errors: string[] = [];
    const warnings: string[] = [];
    const upperSql = sql.toUpperCase();

    // Check for destructive operations without safety nets
    if (upperSql.includes("DROP TABLE") && !upperSql.includes("IF EXISTS")) {
      errors.push("DROP TABLE without IF EXISTS — may fail on missing table");
    }

    if (upperSql.includes("DROP COLUMN") && !upperSql.includes("IF EXISTS")) {
      errors.push("DROP COLUMN without IF EXISTS — may fail on missing column");
    }

    // Warn about potentially slow operations
    if (upperSql.includes("ALTER TABLE") && upperSql.includes("NOT NULL")) {
      warnings.push(
        "Adding NOT NULL column without default requires table rewrite on large tables"
      );
    }

    if (
      upperSql.includes("CREATE INDEX") &&
      !upperSql.includes("CONCURRENTLY")
    ) {
      warnings.push(
        "CREATE INDEX without CONCURRENTLY will lock the table during creation"
      );
    }

    if (upperSql.includes("ALTER TYPE") || upperSql.includes("ALTER COLUMN")) {
      warnings.push("Column type changes may require table locks");
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings,
    };
  }

  /**
   * Estimate whether a migration requires downtime.
   */
  estimateDowntime(sql: string): boolean {
    const upperSql = sql.toUpperCase();

    // Operations that typically require downtime on large tables
    const downtimeIndicators = [
      "DROP TABLE",
      "ALTER COLUMN",
      "ALTER TYPE",
      "RENAME TABLE",
      "RENAME COLUMN",
    ];

    return downtimeIndicators.some((indicator) => upperSql.includes(indicator));
  }

  // ---- Private helpers ----

  private generateCreateTable(table: SchemaSnapshot): string {
    const columns = table.columns.map((col) => {
      let def = `  "${col.name}" ${col.type}`;
      if (!col.nullable) {
        def += " NOT NULL";
      }
      if (col.defaultValue) {
        def += ` DEFAULT ${col.defaultValue}`;
      }
      return def;
    });

    return `CREATE TABLE IF NOT EXISTS "${table.tableName}" (\n${columns.join(",\n")}\n);`;
  }
}
