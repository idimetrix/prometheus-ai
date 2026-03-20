import { createLogger } from "@prometheus/logger";

const logger = createLogger("orchestrator:ci-loop:mutation-testing");

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type MutationType =
  | "negate_condition"
  | "change_operator"
  | "remove_statement"
  | "swap_arguments"
  | "change_constant"
  | "remove_return";

export interface Mutant {
  description: string;
  id: string;
  line: number;
  mutatedCode: string;
  mutationType: MutationType;
  originalCode: string;
}

export type MutantStatus = "killed" | "survived" | "timeout" | "error";

export interface MutantResult {
  mutantId: string;
  status: MutantStatus;
  testOutput?: string;
}

export interface MutationReport {
  killed: number;
  mutationScore: number;
  results: MutantResult[];
  survived: number;
  timeout: number;
  total: number;
  weakTests: string[];
}

// ---------------------------------------------------------------------------
// Mutation operators
// ---------------------------------------------------------------------------

interface MutationEntry {
  description: string;
  mutated: string;
}

interface MutationOperator {
  apply: (code: string) => MutationEntry[];
  name: MutationType;
}

const CONDITION_NEGATE_RE = /\b(if\s*\()(.*?)(\)\s*\{)/g;

const OPERATOR_PAIRS: [RegExp, string, string][] = [
  [/===/, "!==", "changed === to !=="],
  [/!==/, "===", "changed !== to ==="],
  [/<=/, ">", "changed <= to >"],
  [/>=/, "<", "changed >= to <"],
  [/&&/, "||", "changed && to ||"],
  [/\|\|/, "&&", "changed || to &&"],
  [/\+(?!=)/, "-", "changed + to -"],
  [/-(?!=)/, "+", "changed - to +"],
  [/\*(?!=)/, "/", "changed * to /"],
];

const MUTATION_OPERATORS: MutationOperator[] = [
  {
    name: "negate_condition",
    apply(code: string) {
      const results: MutationEntry[] = [];
      const re = new RegExp(CONDITION_NEGATE_RE.source, "g");
      let match: RegExpExecArray | null = null;
      while (true) {
        match = re.exec(code);
        if (!match) {
          break;
        }
        const negated =
          code.slice(0, match.index) +
          `${match[1]}!(${match[2]})${match[3]}` +
          code.slice(match.index + match[0].length);
        results.push({
          mutated: negated,
          description: `Negated condition at offset ${match.index}`,
        });
      }
      return results;
    },
  },
  {
    name: "change_operator",
    apply(code: string) {
      const results: MutationEntry[] = [];
      for (const [pattern, replacement, desc] of OPERATOR_PAIRS) {
        const re = new RegExp(pattern.source, "g");
        const match = re.exec(code);
        if (!match) {
          continue;
        }
        const mutated =
          code.slice(0, match.index) +
          replacement +
          code.slice(match.index + match[0].length);
        results.push({
          mutated,
          description: `${desc} at offset ${match.index}`,
        });
      }
      return results;
    },
  },
  {
    name: "remove_statement",
    apply(code: string) {
      const results: MutationEntry[] = [];
      const lines = code.split("\n");
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i] ?? "";
        const trimmed = line.trim();
        // Only remove simple statements (assignments, function calls)
        if (
          trimmed.endsWith(";") &&
          !trimmed.startsWith("import") &&
          !trimmed.startsWith("export") &&
          !trimmed.startsWith("const ") &&
          !trimmed.startsWith("let ") &&
          !trimmed.startsWith("return")
        ) {
          const mutatedLines = [...lines];
          mutatedLines[i] = `// MUTANT: removed: ${trimmed}`;
          results.push({
            mutated: mutatedLines.join("\n"),
            description: `Removed statement at line ${i + 1}: ${trimmed.slice(0, 50)}`,
          });
        }
      }
      return results;
    },
  },
  {
    name: "swap_arguments",
    apply(code: string) {
      const results: MutationEntry[] = [];
      // Match function calls with 2+ arguments
      const callRe = /(\w+)\(([^,)]+),\s*([^,)]+)\)/g;
      const match = callRe.exec(code);
      if (match) {
        const swapped =
          code.slice(0, match.index) +
          `${match[1]}(${match[3]}, ${match[2]})` +
          code.slice(match.index + match[0].length);
        results.push({
          mutated: swapped,
          description: `Swapped arguments of ${match[1]} at offset ${match.index}`,
        });
      }
      return results;
    },
  },
];

// ---------------------------------------------------------------------------
// MutationTester
// ---------------------------------------------------------------------------

/**
 * MutationTester generates code mutants and runs tests against each to
 * verify test suite quality. A high mutation score indicates tests catch
 * real bugs effectively.
 */
export class MutationTester {
  private results: MutantResult[] = [];

  /**
   * Generate mutants from source code.
   */
  generateMutants(sourceCode: string, _language: string): Mutant[] {
    const mutants: Mutant[] = [];
    let idCounter = 0;

    for (const operator of MUTATION_OPERATORS) {
      const mutations = operator.apply(sourceCode);
      for (const mutation of mutations) {
        idCounter++;
        const id = `mutant-${idCounter}`;
        // Find the first differing line
        const origLines = sourceCode.split("\n");
        const mutLines = mutation.mutated.split("\n");
        let diffLine = 1;
        for (let i = 0; i < origLines.length; i++) {
          if (origLines[i] !== mutLines[i]) {
            diffLine = i + 1;
            break;
          }
        }

        mutants.push({
          id,
          mutationType: operator.name,
          originalCode: sourceCode,
          mutatedCode: mutation.mutated,
          description: mutation.description,
          line: diffLine,
        });
      }
    }

    logger.info(
      { mutantCount: mutants.length },
      "Generated mutants from source"
    );

    return mutants;
  }

  /**
   * Run tests against each mutant. A killed mutant means the test suite
   * correctly detects the mutation. Survived mutants indicate weak tests.
   *
   * @param mutants - The mutants to test
   * @param _testCommand - Command to run tests (e.g., "pnpm test")
   */
  runMutants(mutants: Mutant[], _testCommand: string): MutantResult[] {
    this.results = [];

    for (const mutant of mutants) {
      // In a real implementation, this would:
      // 1. Write the mutated code to disk
      // 2. Run the test command
      // 3. Check if tests fail (killed) or pass (survived)
      // For now we record each mutant as needing evaluation
      const result: MutantResult = {
        mutantId: mutant.id,
        status: "survived",
      };
      this.results.push(result);
    }

    logger.info(
      {
        total: this.results.length,
        killed: this.results.filter((r) => r.status === "killed").length,
        survived: this.results.filter((r) => r.status === "survived").length,
      },
      "Mutation testing complete"
    );

    return this.results;
  }

  /**
   * Record the result of running a specific mutant.
   */
  recordResult(mutantId: string, status: MutantStatus, output?: string): void {
    const existing = this.results.find((r) => r.mutantId === mutantId);
    if (existing) {
      existing.status = status;
      existing.testOutput = output;
    } else {
      this.results.push({ mutantId, status, testOutput: output });
    }
  }

  /**
   * Get the mutation score (killed / total).
   */
  getMutationScore(): number {
    if (this.results.length === 0) {
      return 0;
    }
    const killed = this.results.filter((r) => r.status === "killed").length;
    return killed / this.results.length;
  }

  /**
   * Get tests that did not catch any mutations (survived mutants indicate
   * weak tests covering that code path).
   */
  getWeakTests(): string[] {
    return this.results
      .filter((r) => r.status === "survived")
      .map((r) => r.mutantId);
  }

  /**
   * Generate a full mutation report.
   */
  getReport(): MutationReport {
    const killed = this.results.filter((r) => r.status === "killed").length;
    const survived = this.results.filter((r) => r.status === "survived").length;
    const timeout = this.results.filter((r) => r.status === "timeout").length;

    return {
      total: this.results.length,
      killed,
      survived,
      timeout,
      mutationScore: this.getMutationScore(),
      weakTests: this.getWeakTests(),
      results: this.results,
    };
  }
}
