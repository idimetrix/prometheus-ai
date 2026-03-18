/**
 * Phase 9.3: Symbol Table types and storage.
 *
 * Defines the structured output of the AST parser and provides
 * persistence/retrieval of symbol tables in the knowledge graph.
 */
import { agentMemories, db } from "@prometheus/db";
import { createLogger } from "@prometheus/logger";
import { generateId } from "@prometheus/utils";
import { and, eq, sql } from "drizzle-orm";

const logger = createLogger("project-brain:symbols");

// ─── Symbol Table Types ────────────────────────────────────────────

export interface SymbolTable {
  classes: ParsedClass[];
  exports: ParsedExport[];
  filePath: string;
  functions: ParsedFunction[];
  imports: ParsedImport[];
  interfaces: ParsedInterface[];
  typeAliases: ParsedTypeAlias[];
  variables: ParsedVariable[];
}

export interface ParsedFunction {
  endLine: number;
  exported: boolean;
  isAsync: boolean;
  isGenerator: boolean;
  line: number;
  name: string;
  params: Array<{
    name: string;
    type?: string;
    optional: boolean;
  }>;
  returnType?: string;
  visibility?: "public" | "private" | "protected";
}

export interface ParsedClass {
  endLine: number;
  exported: boolean;
  extends?: string;
  implements?: string[];
  isAbstract: boolean;
  line: number;
  methods: ParsedFunction[];
  name: string;
  properties: Array<{
    name: string;
    type?: string;
    visibility?: string;
  }>;
}

export interface ParsedImport {
  isDefault: boolean;
  isNamespace: boolean;
  isTypeOnly: boolean;
  line: number;
  source: string;
  specifiers: string[];
}

export interface ParsedExport {
  isDefault: boolean;
  kind: string;
  line: number;
  name: string;
  source?: string;
}

export interface ParsedInterface {
  exported: boolean;
  extends?: string[];
  line: number;
  members: Array<{
    name: string;
    type: string;
    optional: boolean;
  }>;
  name: string;
}

export interface ParsedTypeAlias {
  exported: boolean;
  line: number;
  name: string;
  type: string;
}

export interface ParsedVariable {
  exported: boolean;
  kind: string;
  line: number;
  name: string;
  type?: string;
}

// ─── Symbol Storage ────────────────────────────────────────────────

const SYMBOL_PREFIX = "symbols:";

/**
 * SymbolStore persists and retrieves SymbolTables from the
 * agent_memories table using memoryType = 'architectural'.
 */
export class SymbolStore {
  /**
   * Store a symbol table for a file. Replaces any existing entry.
   */
  async store(projectId: string, symbolTable: SymbolTable): Promise<void> {
    const content = `${SYMBOL_PREFIX}${JSON.stringify(symbolTable)}`;
    const lookupKey = `${SYMBOL_PREFIX}${symbolTable.filePath}`;

    // Check for existing symbol table for this file
    const existing = await db
      .select()
      .from(agentMemories)
      .where(
        and(
          eq(agentMemories.projectId, projectId),
          eq(agentMemories.memoryType, "architectural"),
          sql`${agentMemories.content} LIKE ${`${lookupKey}%`}`
        )
      )
      .limit(1);

    if (existing.length > 0) {
      await db
        .update(agentMemories)
        .set({ content })
        .where(eq(agentMemories.id, existing[0]?.id));
    } else {
      await db.insert(agentMemories).values({
        id: generateId("sym"),
        projectId,
        memoryType: "architectural",
        content,
      });
    }

    logger.debug(
      {
        projectId,
        filePath: symbolTable.filePath,
        functions: symbolTable.functions.length,
        classes: symbolTable.classes.length,
      },
      "Symbol table stored"
    );
  }

  /**
   * Retrieve the symbol table for a specific file.
   */
  async get(projectId: string, filePath: string): Promise<SymbolTable | null> {
    const lookupKey = `${SYMBOL_PREFIX}${filePath}`;

    const results = await db
      .select()
      .from(agentMemories)
      .where(
        and(
          eq(agentMemories.projectId, projectId),
          eq(agentMemories.memoryType, "architectural"),
          sql`${agentMemories.content} LIKE ${`${lookupKey}%`}`
        )
      )
      .limit(1);

    if (results.length === 0) {
      return null;
    }

    try {
      const json = results[0]?.content.slice(SYMBOL_PREFIX.length);
      return JSON.parse(json) as SymbolTable;
    } catch {
      return null;
    }
  }

  /**
   * Search for symbols by name across all files in a project.
   */
  async searchSymbol(
    projectId: string,
    symbolName: string
  ): Promise<
    Array<{ filePath: string; kind: string; name: string; line: number }>
  > {
    const results = await db
      .select()
      .from(agentMemories)
      .where(
        and(
          eq(agentMemories.projectId, projectId),
          eq(agentMemories.memoryType, "architectural"),
          sql`${agentMemories.content} LIKE ${`${SYMBOL_PREFIX}%`}`,
          sql`${agentMemories.content} ILIKE ${`%${symbolName}%`}`
        )
      );

    const matches: Array<{
      filePath: string;
      kind: string;
      name: string;
      line: number;
    }> = [];
    const lowerName = symbolName.toLowerCase();

    for (const row of results) {
      try {
        const table = JSON.parse(
          row.content.slice(SYMBOL_PREFIX.length)
        ) as SymbolTable;

        for (const fn of table.functions) {
          if (fn.name.toLowerCase().includes(lowerName)) {
            matches.push({
              filePath: table.filePath,
              kind: "function",
              name: fn.name,
              line: fn.line,
            });
          }
        }
        for (const cls of table.classes) {
          if (cls.name.toLowerCase().includes(lowerName)) {
            matches.push({
              filePath: table.filePath,
              kind: "class",
              name: cls.name,
              line: cls.line,
            });
          }
          for (const method of cls.methods) {
            if (method.name.toLowerCase().includes(lowerName)) {
              matches.push({
                filePath: table.filePath,
                kind: "method",
                name: `${cls.name}.${method.name}`,
                line: method.line,
              });
            }
          }
        }
        for (const iface of table.interfaces) {
          if (iface.name.toLowerCase().includes(lowerName)) {
            matches.push({
              filePath: table.filePath,
              kind: "interface",
              name: iface.name,
              line: iface.line,
            });
          }
        }
        for (const ta of table.typeAliases) {
          if (ta.name.toLowerCase().includes(lowerName)) {
            matches.push({
              filePath: table.filePath,
              kind: "type",
              name: ta.name,
              line: ta.line,
            });
          }
        }
        for (const v of table.variables) {
          if (v.name.toLowerCase().includes(lowerName)) {
            matches.push({
              filePath: table.filePath,
              kind: "variable",
              name: v.name,
              line: v.line,
            });
          }
        }
      } catch {
        // skip malformed
      }
    }

    return matches;
  }

  /**
   * Get all exported symbols for a project (useful for auto-imports).
   */
  async getExportedSymbols(
    projectId: string
  ): Promise<Array<{ filePath: string; name: string; kind: string }>> {
    const results = await db
      .select()
      .from(agentMemories)
      .where(
        and(
          eq(agentMemories.projectId, projectId),
          eq(agentMemories.memoryType, "architectural"),
          sql`${agentMemories.content} LIKE ${`${SYMBOL_PREFIX}%`}`
        )
      );

    const exported: Array<{ filePath: string; name: string; kind: string }> =
      [];

    for (const row of results) {
      try {
        const table = JSON.parse(
          row.content.slice(SYMBOL_PREFIX.length)
        ) as SymbolTable;

        for (const exp of table.exports) {
          exported.push({
            filePath: table.filePath,
            name: exp.name,
            kind: exp.kind,
          });
        }
      } catch {
        // skip malformed
      }
    }

    return exported;
  }

  /**
   * Get summary statistics for all symbol tables in a project.
   */
  async getStats(projectId: string): Promise<{
    totalFiles: number;
    totalFunctions: number;
    totalClasses: number;
    totalInterfaces: number;
    totalExports: number;
  }> {
    const results = await db
      .select()
      .from(agentMemories)
      .where(
        and(
          eq(agentMemories.projectId, projectId),
          eq(agentMemories.memoryType, "architectural"),
          sql`${agentMemories.content} LIKE ${`${SYMBOL_PREFIX}%`}`
        )
      );

    let totalFiles = 0;
    let totalFunctions = 0;
    let totalClasses = 0;
    let totalInterfaces = 0;
    let totalExports = 0;

    for (const row of results) {
      try {
        const table = JSON.parse(
          row.content.slice(SYMBOL_PREFIX.length)
        ) as SymbolTable;
        totalFiles++;
        totalFunctions += table.functions.length;
        totalClasses += table.classes.length;
        totalInterfaces += table.interfaces.length;
        totalExports += table.exports.length;
      } catch {
        // skip malformed
      }
    }

    return {
      totalFiles,
      totalFunctions,
      totalClasses,
      totalInterfaces,
      totalExports,
    };
  }
}
