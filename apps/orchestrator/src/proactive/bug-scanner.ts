/**
 * Proactive Bug Scanner
 *
 * Walks a project's file tree and scans each code file for potential issues:
 * 1. Static analysis: console.log in prod, TODO/FIXME, unused imports
 * 2. Security: hardcoded secrets, SQL injection patterns, XSS risks
 * 3. Performance: N+1 queries, unnecessary re-renders, missing memoization
 * 4. LLM-powered deeper analysis for suspicious code
 *
 * Auto-fixable findings can be patched automatically via the model router.
 */

import { createLogger } from "@prometheus/logger";

const IMPORT_LINE_RE = /^import\s+.*from\s+['"][^'"]+['"];?\s*$/gm;
const NAMED_IMPORT_RE = /import\s+(?:type\s+)?(\w+)/;
const JSON_ARRAY_RE = /\[[\s\S]*\]/;

import {
  generateId,
  modelRouterClient,
  sandboxManagerClient,
} from "@prometheus/utils";

const logger = createLogger("orchestrator:proactive:bug-scanner");

const SEVERITY_ORDER: Record<ScanFinding["severity"], number> = {
  critical: 0,
  error: 1,
  warning: 2,
  info: 3,
};

const CODE_EXTENSIONS = new Set([
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  ".py",
  ".go",
  ".rs",
  ".java",
  ".vue",
  ".svelte",
]);

const SKIP_DIRS = new Set([
  "node_modules",
  ".git",
  "dist",
  "build",
  ".next",
  ".turbo",
  "coverage",
  "__pycache__",
  ".cache",
]);

// ---------------------------------------------------------------------------
// Static analysis patterns
// ---------------------------------------------------------------------------

const CONSOLE_LOG_RE = /\bconsole\.(log|debug|info)\b/;
const TODO_FIXME_RE = /\b(TODO|FIXME|HACK|XXX|TEMP)\b/i;
const _UNUSED_IMPORT_RE =
  /^import\s+(?:type\s+)?(?:\{[^}]*\}|\w+).*from\s+['"][^'"]+['"];?\s*$/m;

// Security patterns
const HARDCODED_SECRET_RE =
  /(?:password|secret|api_?key|token|private_?key)\s*[:=]\s*['"][^'"]{8,}['"]/i;
const SQL_INJECTION_RE =
  /(?:query|execute|raw)\s*\(\s*[`'"].*\$\{|(?:query|execute|raw)\s*\(\s*['"].*\+\s*\w+/i;
const XSS_RISK_RE =
  /dangerouslySetInnerHTML|innerHTML\s*=|document\.write\s*\(/;
const EVAL_RE = /\beval\s*\(|new\s+Function\s*\(/;

// Performance patterns
const N_PLUS_ONE_RE =
  /for\s*\(.*\)\s*\{[^}]*(?:await\s+)?(?:db\.|prisma\.|query\(|findOne|findFirst|findUnique)/;
const _MISSING_MEMO_RE = /(?:function|const)\s+\w+.*(?:useCallback|useMemo)\b/;
const _RERENDER_RISK_RE = /(?:useState|useReducer)\s*\(\s*(?:\{|\[)(?:[^)]*)\)/;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ScanFinding {
  autoFixable: boolean;
  category: "security" | "bug" | "performance" | "style" | "deprecated";
  file: string;
  id: string;
  line?: number;
  message: string;
  severity: "info" | "warning" | "error" | "critical";
  suggestion?: string;
}

// ---------------------------------------------------------------------------
// BugScanner
// ---------------------------------------------------------------------------

export class BugScanner {
  readonly sandboxId: string;

  constructor(sandboxId: string, _modelRouterUrl: string) {
    this.sandboxId = sandboxId;
  }

  /**
   * Scan an entire project directory for potential bugs, security issues,
   * and performance problems. Returns findings sorted by severity.
   */
  async scanProject(workspaceDir: string): Promise<ScanFinding[]> {
    logger.info(
      { sandboxId: this.sandboxId, workspaceDir },
      "Starting project scan"
    );

    const files = await this.listCodeFiles(workspaceDir);
    logger.info(
      { fileCount: files.length, sandboxId: this.sandboxId },
      "Code files discovered"
    );

    return this.scanFiles(files);
  }

  /**
   * Scan a specific list of files and return findings sorted by severity.
   */
  async scanFiles(files: string[]): Promise<ScanFinding[]> {
    const allFindings: ScanFinding[] = [];

    for (const filePath of files) {
      try {
        const content = await this.readFile(filePath);
        if (!content) {
          continue;
        }

        const staticFindings = this.runStaticChecks(filePath, content);
        allFindings.push(...staticFindings);

        const securityFindings = this.runSecurityChecks(filePath, content);
        allFindings.push(...securityFindings);

        const perfFindings = this.runPerformanceChecks(filePath, content);
        allFindings.push(...perfFindings);
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        logger.warn({ file: filePath, error: msg }, "Failed to scan file");
      }
    }

    // Send suspicious files to LLM for deeper analysis
    const suspiciousFiles = files.filter((f) => {
      const fileFindings = allFindings.filter((finding) => finding.file === f);
      return (
        fileFindings.length > 0 &&
        fileFindings.some(
          (finding) =>
            finding.severity === "error" || finding.severity === "critical"
        )
      );
    });

    if (suspiciousFiles.length > 0) {
      const llmFindings = await this.runLlmAnalysis(
        suspiciousFiles.slice(0, 10)
      );
      allFindings.push(...llmFindings);
    }

    return this.sortBySeverity(allFindings);
  }

  /**
   * Attempt to auto-fix findings that are marked as autoFixable.
   * Uses the model router to generate patches and applies them.
   */
  async autoFix(
    findings: ScanFinding[]
  ): Promise<{ fixed: number; failed: number }> {
    const fixable = findings.filter((f) => f.autoFixable);
    let fixed = 0;
    let failed = 0;

    // Group by file to minimize reads/writes
    const byFile = new Map<string, ScanFinding[]>();
    for (const finding of fixable) {
      const existing = byFile.get(finding.file) ?? [];
      existing.push(finding);
      byFile.set(finding.file, existing);
    }

    for (const [filePath, fileFindings] of byFile) {
      try {
        const content = await this.readFile(filePath);
        if (!content) {
          failed += fileFindings.length;
          continue;
        }

        const patchedContent = await this.generateFix(
          filePath,
          content,
          fileFindings
        );

        if (patchedContent && patchedContent !== content) {
          await this.writeFile(filePath, patchedContent);
          fixed += fileFindings.length;
          logger.info(
            { file: filePath, findingCount: fileFindings.length },
            "Auto-fixed findings"
          );
        } else {
          failed += fileFindings.length;
        }
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        logger.warn(
          { file: filePath, error: msg },
          "Failed to auto-fix findings"
        );
        failed += fileFindings.length;
      }
    }

    logger.info(
      { fixed, failed, sandboxId: this.sandboxId },
      "Auto-fix complete"
    );

    return { fixed, failed };
  }

  // -------------------------------------------------------------------------
  // Static analysis checks
  // -------------------------------------------------------------------------

  // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: static analysis requires checking many patterns
  private runStaticChecks(filePath: string, content: string): ScanFinding[] {
    const findings: ScanFinding[] = [];
    const lines = content.split("\n");

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i] ?? "";
      const lineNum = i + 1;

      if (CONSOLE_LOG_RE.test(line)) {
        findings.push({
          id: generateId("finding"),
          file: filePath,
          line: lineNum,
          severity: "warning",
          category: "style",
          message: "console.log/debug/info statement found in code",
          suggestion: "Remove or replace with a structured logger",
          autoFixable: true,
        });
      }

      if (TODO_FIXME_RE.test(line)) {
        findings.push({
          id: generateId("finding"),
          file: filePath,
          line: lineNum,
          severity: "info",
          category: "style",
          message: `TODO/FIXME comment: ${line.trim().slice(0, 100)}`,
          autoFixable: false,
        });
      }
    }

    // Check for unused imports (simplified heuristic)
    const importLines = content.match(IMPORT_LINE_RE);
    if (importLines) {
      for (const importLine of importLines) {
        const namedMatch = importLine.match(NAMED_IMPORT_RE);
        if (namedMatch?.[1]) {
          const name = namedMatch[1];
          // Check if the imported name appears elsewhere in the file
          const contentWithoutImports = content.replace(/^import\s+.*$/gm, "");
          if (!contentWithoutImports.includes(name)) {
            const importLineNum =
              lines.findIndex((l) => l.includes(importLine.trim())) + 1;
            findings.push({
              id: generateId("finding"),
              file: filePath,
              line: importLineNum > 0 ? importLineNum : undefined,
              severity: "warning",
              category: "style",
              message: `Potentially unused import: ${name}`,
              suggestion: `Remove the import of '${name}' if unused`,
              autoFixable: true,
            });
          }
        }
      }
    }

    return findings;
  }

  // -------------------------------------------------------------------------
  // Security checks
  // -------------------------------------------------------------------------

  private runSecurityChecks(filePath: string, content: string): ScanFinding[] {
    const findings: ScanFinding[] = [];
    const lines = content.split("\n");

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i] ?? "";
      const lineNum = i + 1;

      if (HARDCODED_SECRET_RE.test(line)) {
        findings.push({
          id: generateId("finding"),
          file: filePath,
          line: lineNum,
          severity: "critical",
          category: "security",
          message: "Potential hardcoded secret or credential detected",
          suggestion: "Move to environment variable or secret manager",
          autoFixable: false,
        });
      }

      if (SQL_INJECTION_RE.test(line)) {
        findings.push({
          id: generateId("finding"),
          file: filePath,
          line: lineNum,
          severity: "critical",
          category: "security",
          message: "Potential SQL injection via string concatenation",
          suggestion: "Use parameterized queries or an ORM query builder",
          autoFixable: false,
        });
      }

      if (XSS_RISK_RE.test(line)) {
        findings.push({
          id: generateId("finding"),
          file: filePath,
          line: lineNum,
          severity: "error",
          category: "security",
          message:
            "Potential XSS risk via dangerouslySetInnerHTML or innerHTML",
          suggestion: "Sanitize HTML content before rendering",
          autoFixable: false,
        });
      }

      if (EVAL_RE.test(line)) {
        findings.push({
          id: generateId("finding"),
          file: filePath,
          line: lineNum,
          severity: "critical",
          category: "security",
          message: "Dynamic code execution via eval() or new Function()",
          suggestion:
            "Avoid eval; use safer alternatives like JSON.parse or a sandboxed interpreter",
          autoFixable: false,
        });
      }
    }

    return findings;
  }

  // -------------------------------------------------------------------------
  // Performance checks
  // -------------------------------------------------------------------------

  private runPerformanceChecks(
    filePath: string,
    content: string
  ): ScanFinding[] {
    const findings: ScanFinding[] = [];

    // N+1 query detection (simplified)
    if (N_PLUS_ONE_RE.test(content)) {
      const lines = content.split("\n");
      for (let i = 0; i < lines.length; i++) {
        const window = lines.slice(i, i + 5).join("\n");
        if (N_PLUS_ONE_RE.test(window)) {
          findings.push({
            id: generateId("finding"),
            file: filePath,
            line: i + 1,
            severity: "warning",
            category: "performance",
            message: "Potential N+1 query: database call inside a loop",
            suggestion:
              "Batch the query outside the loop or use a join/include",
            autoFixable: false,
          });
          break;
        }
      }
    }

    // Check for components that may cause unnecessary re-renders
    if (
      (filePath.endsWith(".tsx") || filePath.endsWith(".jsx")) &&
      content.includes("useState") &&
      !content.includes("useMemo") &&
      !content.includes("useCallback") &&
      content.includes("map(")
    ) {
      findings.push({
        id: generateId("finding"),
        file: filePath,
        severity: "info",
        category: "performance",
        message:
          "Component with state and mapped children may benefit from memoization",
        suggestion:
          "Consider React.memo, useMemo, or useCallback to prevent unnecessary re-renders",
        autoFixable: false,
      });
    }

    return findings;
  }

  // -------------------------------------------------------------------------
  // LLM-powered deep analysis
  // -------------------------------------------------------------------------

  private async runLlmAnalysis(files: string[]): Promise<ScanFinding[]> {
    const findings: ScanFinding[] = [];

    for (const filePath of files) {
      try {
        const content = await this.readFile(filePath);
        if (!content) {
          continue;
        }

        // Truncate large files for LLM context
        const truncated = content.slice(0, 6000);

        const response = await modelRouterClient.post<{
          choices: Array<{ message: { content: string } }>;
        }>("/route", {
          slot: "think",
          messages: [
            {
              role: "user",
              content: `Analyze this code for bugs, security issues, and performance problems.

File: ${filePath}

\`\`\`
${truncated}
\`\`\`

Return a JSON array of findings. Each finding must have:
- "line": number or null
- "severity": "info" | "warning" | "error" | "critical"
- "category": "security" | "bug" | "performance" | "style" | "deprecated"
- "message": string describing the issue
- "suggestion": string with fix recommendation
- "autoFixable": boolean

Only report real issues. Return [] if no issues found.
Output ONLY the JSON array.`,
            },
          ],
          options: { maxTokens: 2048, temperature: 0.1 },
        });

        const raw = response.data.choices[0]?.message.content ?? "[]";
        const jsonMatch = raw.match(JSON_ARRAY_RE);
        if (jsonMatch) {
          const parsed = JSON.parse(jsonMatch[0]) as Array<{
            autoFixable: boolean;
            category: ScanFinding["category"];
            line: number | null;
            message: string;
            severity: ScanFinding["severity"];
            suggestion: string;
          }>;

          for (const item of parsed) {
            findings.push({
              id: generateId("finding"),
              file: filePath,
              line: item.line ?? undefined,
              severity: item.severity,
              category: item.category,
              message: item.message,
              suggestion: item.suggestion,
              autoFixable: item.autoFixable,
            });
          }
        }
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        logger.warn(
          { file: filePath, error: msg },
          "LLM analysis failed for file"
        );
      }
    }

    return findings;
  }

  // -------------------------------------------------------------------------
  // Fix generation
  // -------------------------------------------------------------------------

  private async generateFix(
    filePath: string,
    content: string,
    findings: ScanFinding[]
  ): Promise<string | null> {
    try {
      const findingDescriptions = findings
        .map(
          (f) =>
            `- Line ${f.line ?? "?"}: [${f.category}] ${f.message}${f.suggestion ? ` (suggestion: ${f.suggestion})` : ""}`
        )
        .join("\n");

      const response = await modelRouterClient.post<{
        choices: Array<{ message: { content: string } }>;
      }>("/route", {
        slot: "default",
        messages: [
          {
            role: "user",
            content: `Fix the following issues in this file. Return ONLY the complete corrected file content, no markdown fences, no explanation.

File: ${filePath}

Issues:
${findingDescriptions}

Current content:
${content}`,
          },
        ],
        options: { maxTokens: 8192, temperature: 0.1 },
      });

      return response.data.choices[0]?.message.content ?? null;
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      logger.warn({ file: filePath, error: msg }, "Fix generation failed");
      return null;
    }
  }

  // -------------------------------------------------------------------------
  // Sandbox file operations
  // -------------------------------------------------------------------------

  private async listCodeFiles(workspaceDir: string): Promise<string[]> {
    try {
      const response = await sandboxManagerClient.post<{
        exitCode: number;
        stderr: string;
        stdout: string;
      }>(`/sandboxes/${this.sandboxId}/exec`, {
        command: "find",
        args: [
          workspaceDir,
          "-type",
          "f",
          "-name",
          "*.ts",
          "-o",
          "-name",
          "*.tsx",
          "-o",
          "-name",
          "*.js",
          "-o",
          "-name",
          "*.jsx",
          "-o",
          "-name",
          "*.py",
          "-o",
          "-name",
          "*.go",
        ],
        timeout: 30_000,
      });

      if (response.data.exitCode !== 0) {
        logger.warn(
          { stderr: response.data.stderr },
          "File listing returned non-zero exit code"
        );
      }

      return response.data.stdout.split("\n").filter((line) => {
        if (!line.trim()) {
          return false;
        }
        // Skip files in excluded directories
        for (const dir of SKIP_DIRS) {
          if (line.includes(`/${dir}/`)) {
            return false;
          }
        }
        // Only include code files
        const ext = line.slice(line.lastIndexOf("."));
        return CODE_EXTENSIONS.has(ext);
      });
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      logger.error(
        { sandboxId: this.sandboxId, error: msg },
        "Failed to list code files"
      );
      return [];
    }
  }

  private async readFile(filePath: string): Promise<string | null> {
    try {
      const response = await sandboxManagerClient.post<{
        exitCode: number;
        stderr: string;
        stdout: string;
      }>(`/sandboxes/${this.sandboxId}/exec`, {
        command: "cat",
        args: [filePath],
        timeout: 10_000,
      });

      if (response.data.exitCode !== 0) {
        return null;
      }

      return response.data.stdout;
    } catch {
      return null;
    }
  }

  private async writeFile(filePath: string, content: string): Promise<void> {
    await sandboxManagerClient.post(`/sandboxes/${this.sandboxId}/exec`, {
      command: "tee",
      args: [filePath],
      stdin: content,
      timeout: 10_000,
    });
  }

  // -------------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------------

  private sortBySeverity(findings: ScanFinding[]): ScanFinding[] {
    return findings.sort(
      (a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]
    );
  }
}
