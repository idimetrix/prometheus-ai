/**
 * Auto-Documentation Generator — Automatically generates documentation
 * from source code, including file docs, API references, and architecture
 * overviews in markdown format.
 */

import { createLogger } from "@prometheus/logger";

const logger = createLogger("project-brain:auto-doc-generator");

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface FileDoc {
  content: string;
  exports: string[];
  filePath: string;
  language: string;
  summary: string;
}

export interface ProjectDoc {
  apiReference: string;
  files: FileDoc[];
  overview: string;
  projectPath: string;
}

export interface CodeGraphNode {
  dependencies: string[];
  filePath: string;
  name: string;
  type: "module" | "class" | "function" | "route";
}

export interface RouterFile {
  content: string;
  filePath: string;
  framework: string;
}

// ---------------------------------------------------------------------------
// Patterns for code analysis
// ---------------------------------------------------------------------------

const EXPORT_PATTERN =
  /export\s+(?:default\s+)?(?:class|function|const|interface|type|enum)\s+(\w+)/g;
const FUNCTION_PATTERN =
  /(?:export\s+)?(?:async\s+)?function\s+(\w+)\s*\(([^)]*)\)(?:\s*:\s*([^\n{]+))?/g;
const CLASS_PATTERN =
  /(?:export\s+)?class\s+(\w+)(?:\s+extends\s+(\w+))?(?:\s+implements\s+([^\n{]+))?/g;
const INTERFACE_PATTERN =
  /(?:export\s+)?interface\s+(\w+)(?:\s+extends\s+([^\n{]+))?/g;
const JSDOC_PATTERN = /\/\*\*\s*([\s\S]*?)\s*\*\//g;
const JSDOC_LINE_CLEAN_RE = /^\s*\*\s?/;
const COLON_PREFIX_RE = /^:/;
const HONO_ROUTE_RE =
  /app\.(get|post|put|delete|patch)\s*\(\s*['"]([^'"]+)['"]/g;
const TRPC_PROC_RE =
  /(\w+):\s*(?:publicProcedure|protectedProcedure)\s*\.\s*(query|mutation)/g;

// ---------------------------------------------------------------------------
// AutoDocGenerator
// ---------------------------------------------------------------------------

export class AutoDocGenerator {
  /**
   * Generate documentation for a single file.
   */
  generateForFile(
    filePath: string,
    content: string,
    language: string
  ): FileDoc {
    logger.debug({ filePath, language }, "Generating file documentation");

    const exports = this.extractExports(content);
    const functions = this.extractFunctions(content);
    const classes = this.extractClasses(content);
    const interfaces = this.extractInterfaces(content);
    const jsdocComments = this.extractJSDoc(content);

    const sections: string[] = [
      `# ${this.getFileName(filePath)}`,
      "",
      `**Path:** \`${filePath}\``,
      `**Language:** ${language}`,
      "",
    ];

    this.appendDescriptionSection(sections, jsdocComments);
    this.appendExportsSection(sections, exports);
    this.appendClassesSection(sections, classes);
    this.appendFunctionsSection(sections, functions);
    this.appendInterfacesSection(sections, interfaces);

    const docContent = sections.join("\n");
    const summary = this.generateSummary(exports, functions, classes);

    return { filePath, language, content: docContent, exports, summary };
  }

  private appendDescriptionSection(
    sections: string[],
    jsdocComments: string[]
  ): void {
    if (jsdocComments.length === 0) {
      return;
    }
    sections.push("## Description", jsdocComments[0] ?? "", "");
  }

  private appendExportsSection(sections: string[], exports: string[]): void {
    if (exports.length === 0) {
      return;
    }
    sections.push("## Exports");
    for (const exp of exports) {
      sections.push(`- \`${exp}\``);
    }
    sections.push("");
  }

  private appendClassesSection(
    sections: string[],
    classes: Array<{ name: string; extends?: string; implements?: string }>
  ): void {
    if (classes.length === 0) {
      return;
    }
    sections.push("## Classes");
    for (const cls of classes) {
      sections.push(`### ${cls.name}`);
      if (cls.extends) {
        sections.push(`Extends: \`${cls.extends}\``);
      }
      if (cls.implements) {
        sections.push(`Implements: \`${cls.implements}\``);
      }
      sections.push("");
    }
  }

  private appendFunctionsSection(
    sections: string[],
    functions: Array<{ name: string; params: string; returnType?: string }>
  ): void {
    if (functions.length === 0) {
      return;
    }
    sections.push("## Functions");
    for (const fn of functions) {
      sections.push(`### \`${fn.name}(${fn.params})\``);
      if (fn.returnType) {
        sections.push(`Returns: \`${fn.returnType.trim()}\``);
      }
      sections.push("");
    }
  }

  private appendInterfacesSection(
    sections: string[],
    interfaces: Array<{ name: string; extends?: string }>
  ): void {
    if (interfaces.length === 0) {
      return;
    }
    sections.push("## Interfaces");
    for (const iface of interfaces) {
      sections.push(`### ${iface.name}`);
      if (iface.extends) {
        sections.push(`Extends: \`${iface.extends}\``);
      }
      sections.push("");
    }
  }

  /**
   * Generate documentation for an entire project.
   */
  generateForProject(
    projectPath: string,
    files: Array<{ path: string; content: string; language: string }>
  ): ProjectDoc {
    logger.info(
      { projectPath, fileCount: files.length },
      "Generating project documentation"
    );

    const fileDocs: FileDoc[] = [];
    for (const file of files) {
      const doc = this.generateForFile(file.path, file.content, file.language);
      fileDocs.push(doc);
    }

    const overview = this.generateProjectOverview(projectPath, fileDocs);
    const apiReference = this.generateAPIReference(
      files
        .filter(
          (f) =>
            f.content.includes("app.get") ||
            f.content.includes("app.post") ||
            f.content.includes("router(")
        )
        .map((f) => ({
          filePath: f.path,
          content: f.content,
          framework: f.content.includes("Hono") ? "hono" : "trpc",
        }))
    );

    return {
      projectPath,
      overview,
      files: fileDocs,
      apiReference,
    };
  }

  /**
   * Generate API reference from router files.
   */
  generateAPIReference(routerFiles: RouterFile[]): string {
    logger.debug({ fileCount: routerFiles.length }, "Generating API reference");

    const sections: string[] = [];
    sections.push("# API Reference");
    sections.push("");

    for (const file of routerFiles) {
      sections.push(`## ${this.getFileName(file.filePath)}`);
      sections.push(`Framework: ${file.framework}`);
      sections.push("");

      if (file.framework === "hono") {
        const routes = this.extractHonoRoutes(file.content);
        if (routes.length > 0) {
          sections.push("| Method | Path | Description |");
          sections.push("|--------|------|-------------|");
          for (const route of routes) {
            sections.push(
              `| ${route.method.toUpperCase()} | \`${route.path}\` | ${route.description} |`
            );
          }
          sections.push("");
        }
      } else if (file.framework === "trpc") {
        const procedures = this.extractTRPCProcedures(file.content);
        if (procedures.length > 0) {
          sections.push("| Procedure | Type | Description |");
          sections.push("|-----------|------|-------------|");
          for (const proc of procedures) {
            sections.push(
              `| \`${proc.name}\` | ${proc.type} | ${proc.description} |`
            );
          }
          sections.push("");
        }
      }
    }

    return sections.join("\n");
  }

  /**
   * Generate architecture documentation from a code graph.
   */
  generateArchitectureDoc(codeGraph: CodeGraphNode[]): string {
    logger.debug(
      { nodeCount: codeGraph.length },
      "Generating architecture documentation"
    );

    const sections: string[] = [];
    sections.push("# Architecture Overview");
    sections.push("");

    const modules = codeGraph.filter((n) => n.type === "module");
    const classes = codeGraph.filter((n) => n.type === "class");
    const routes = codeGraph.filter((n) => n.type === "route");

    if (modules.length > 0) {
      sections.push("## Modules");
      for (const mod of modules) {
        sections.push(`### ${mod.name}`);
        sections.push(`Path: \`${mod.filePath}\``);
        if (mod.dependencies.length > 0) {
          sections.push(
            `Dependencies: ${mod.dependencies.map((d) => `\`${d}\``).join(", ")}`
          );
        }
        sections.push("");
      }
    }

    if (classes.length > 0) {
      sections.push("## Classes");
      for (const cls of classes) {
        sections.push(`### ${cls.name}`);
        sections.push(`Path: \`${cls.filePath}\``);
        if (cls.dependencies.length > 0) {
          sections.push(
            `Dependencies: ${cls.dependencies.map((d) => `\`${d}\``).join(", ")}`
          );
        }
        sections.push("");
      }
    }

    if (routes.length > 0) {
      sections.push("## Routes");
      for (const route of routes) {
        sections.push(`- \`${route.name}\` (\`${route.filePath}\`)`);
      }
      sections.push("");
    }

    sections.push("## Dependency Summary");
    sections.push("");
    sections.push("| Component | Dependencies Count |");
    sections.push("|-----------|-------------------|");
    for (const node of codeGraph) {
      sections.push(`| ${node.name} | ${node.dependencies.length} |`);
    }

    return sections.join("\n");
  }

  // ---- Private helpers ------------------------------------------------------

  private extractExports(content: string): string[] {
    const exports: string[] = [];
    let match = EXPORT_PATTERN.exec(content);
    while (match) {
      exports.push(match[1] ?? "");
      match = EXPORT_PATTERN.exec(content);
    }
    return exports;
  }

  private extractFunctions(
    content: string
  ): Array<{ name: string; params: string; returnType?: string }> {
    const functions: Array<{
      name: string;
      params: string;
      returnType?: string;
    }> = [];
    let match = FUNCTION_PATTERN.exec(content);
    while (match) {
      functions.push({
        name: match[1] ?? "",
        params: match[2] ?? "",
        returnType: match[3],
      });
      match = FUNCTION_PATTERN.exec(content);
    }
    return functions;
  }

  private extractClasses(
    content: string
  ): Array<{ extends?: string; implements?: string; name: string }> {
    const classes: Array<{
      extends?: string;
      implements?: string;
      name: string;
    }> = [];
    let match = CLASS_PATTERN.exec(content);
    while (match) {
      classes.push({
        name: match[1] ?? "",
        extends: match[2],
        implements: match[3],
      });
      match = CLASS_PATTERN.exec(content);
    }
    return classes;
  }

  private extractInterfaces(
    content: string
  ): Array<{ extends?: string; name: string }> {
    const interfaces: Array<{ extends?: string; name: string }> = [];
    let match = INTERFACE_PATTERN.exec(content);
    while (match) {
      interfaces.push({ name: match[1] ?? "", extends: match[2] });
      match = INTERFACE_PATTERN.exec(content);
    }
    return interfaces;
  }

  private extractJSDoc(content: string): string[] {
    const docs: string[] = [];
    let match = JSDOC_PATTERN.exec(content);
    while (match) {
      const cleaned = (match[1] ?? "")
        .split("\n")
        .map((line) => line.replace(JSDOC_LINE_CLEAN_RE, "").trim())
        .filter(Boolean)
        .join(" ");
      docs.push(cleaned);
      match = JSDOC_PATTERN.exec(content);
    }
    return docs;
  }

  private extractHonoRoutes(
    content: string
  ): Array<{ description: string; method: string; path: string }> {
    const routes: Array<{
      description: string;
      method: string;
      path: string;
    }> = [];
    HONO_ROUTE_RE.lastIndex = 0;
    let match = HONO_ROUTE_RE.exec(content);
    while (match) {
      routes.push({
        method: match[1] ?? "",
        path: match[2] ?? "",
        description: this.inferRouteDescription(match[2] ?? "", match[1] ?? ""),
      });
      match = HONO_ROUTE_RE.exec(content);
    }
    return routes;
  }

  private extractTRPCProcedures(
    content: string
  ): Array<{ description: string; name: string; type: string }> {
    const procedures: Array<{
      description: string;
      name: string;
      type: string;
    }> = [];
    TRPC_PROC_RE.lastIndex = 0;
    let match = TRPC_PROC_RE.exec(content);
    while (match) {
      procedures.push({
        name: match[1] ?? "",
        type: match[2] ?? "query",
        description: `${match[2] ?? "query"} procedure`,
      });
      match = TRPC_PROC_RE.exec(content);
    }
    return procedures;
  }

  private inferRouteDescription(path: string, method: string): string {
    const resource = path.split("/").filter(Boolean).pop() ?? "resource";
    const cleanResource = resource.replace(COLON_PREFIX_RE, "");
    switch (method) {
      case "get":
        return `Get ${cleanResource}`;
      case "post":
        return `Create ${cleanResource}`;
      case "put":
        return `Update ${cleanResource}`;
      case "delete":
        return `Delete ${cleanResource}`;
      case "patch":
        return `Patch ${cleanResource}`;
      default:
        return `${method} ${cleanResource}`;
    }
  }

  private generateSummary(
    exports: string[],
    functions: Array<{ name: string }>,
    classes: Array<{ name: string }>
  ): string {
    const parts: string[] = [];
    if (classes.length > 0) {
      parts.push(
        `${classes.length} class${classes.length > 1 ? "es" : ""}: ${classes.map((c) => c.name).join(", ")}`
      );
    }
    if (functions.length > 0) {
      parts.push(
        `${functions.length} function${functions.length > 1 ? "s" : ""}`
      );
    }
    if (exports.length > 0) {
      parts.push(`${exports.length} export${exports.length > 1 ? "s" : ""}`);
    }
    return parts.join("; ") || "No public API";
  }

  private generateProjectOverview(
    projectPath: string,
    fileDocs: FileDoc[]
  ): string {
    const sections: string[] = [];
    sections.push("# Project Overview");
    sections.push("");
    sections.push(`**Path:** \`${projectPath}\``);
    sections.push(`**Files:** ${fileDocs.length}`);
    sections.push("");

    sections.push("## File Index");
    sections.push("");
    sections.push("| File | Summary |");
    sections.push("|------|---------|");
    for (const doc of fileDocs) {
      sections.push(`| \`${doc.filePath}\` | ${doc.summary} |`);
    }

    return sections.join("\n");
  }

  private getFileName(filePath: string): string {
    return filePath.split("/").pop() ?? filePath;
  }
}
