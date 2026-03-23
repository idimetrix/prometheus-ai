import { createLogger } from "@prometheus/logger";

const logger = createLogger("agent-sdk:test-generator");

const THROWS_ERROR_RE = /throws?|error|exception|invalid/i;
const NULLABLE_RE = /null|undefined|optional|\?/;
const STRING_TYPE_RE = /^(string|str|String|&str)$/i;
const NUMERIC_TYPE_RE =
  /^(number|int|i32|i64|u32|u64|f32|f64|float|double|Integer|Long)$/i;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type SupportedLanguage =
  | "typescript"
  | "python"
  | "rust"
  | "go"
  | "java";

export interface GeneratedTest {
  content: string;
  coverageTargets: string[];
  fileName: string;
  framework: string;
}

export interface FunctionParam {
  name: string;
  type: string;
}

export interface FunctionSignature {
  docComment?: string;
  language: SupportedLanguage;
  name: string;
  params: FunctionParam[];
  returnType: string;
}

export interface TestCase {
  assertion: string;
  description: string;
  inputs: Record<string, string>;
}

// ---------------------------------------------------------------------------
// Framework mapping
// ---------------------------------------------------------------------------

const FRAMEWORK_MAP: Record<SupportedLanguage, string> = {
  typescript: "vitest",
  python: "pytest",
  rust: "cargo test",
  go: "testing",
  java: "junit5",
};

const FILE_EXTENSION_MAP: Record<SupportedLanguage, string> = {
  typescript: ".test.ts",
  python: "_test.py",
  rust: "_test.rs",
  go: "_test.go",
  java: "Test.java",
};

// ---------------------------------------------------------------------------
// TestGenerator
// ---------------------------------------------------------------------------

/**
 * Generates test skeletons and test cases from function signatures and AST
 * information. Supports multiple languages and testing frameworks.
 */
export class TestGenerator {
  /**
   * Get the appropriate test framework for the given language.
   */
  getTestFramework(language: SupportedLanguage): string {
    return FRAMEWORK_MAP[language];
  }

  /**
   * Generate a test skeleton for a function.
   */
  generateTestSkeleton(
    functionName: string,
    params: FunctionParam[],
    returnType: string,
    language: SupportedLanguage
  ): GeneratedTest {
    const framework = this.getTestFramework(language);
    const fileName = `${functionName}${FILE_EXTENSION_MAP[language]}`;

    logger.info(
      { functionName, language, framework },
      "Generating test skeleton"
    );

    const content = this.buildSkeleton(
      functionName,
      params,
      returnType,
      language
    );

    return {
      fileName,
      content,
      framework,
      coverageTargets: [functionName],
    };
  }

  /**
   * Generate specific test cases from a function signature and optional doc
   * comment. Produces edge-case, happy-path, and error-path test cases.
   */
  generateTestCases(
    signature: FunctionSignature,
    docComment?: string
  ): TestCase[] {
    const cases: TestCase[] = [];
    const comment = docComment ?? signature.docComment ?? "";

    // Happy path test
    cases.push({
      description: "should return correct result for valid inputs",
      inputs: this.generateDefaultInputs(signature.params, signature.language),
      assertion: "expect(result).toBeDefined()",
    });

    // Null/undefined inputs for each param
    for (const param of signature.params) {
      if (this.isNullable(param.type)) {
        cases.push({
          description: `should handle null ${param.name}`,
          inputs: {
            ...this.generateDefaultInputs(signature.params, signature.language),
            [param.name]: "null",
          },
          assertion: "expect(result).toBeDefined()",
        });
      }
    }

    // Empty string inputs
    for (const param of signature.params) {
      if (this.isStringType(param.type)) {
        cases.push({
          description: `should handle empty ${param.name}`,
          inputs: {
            ...this.generateDefaultInputs(signature.params, signature.language),
            [param.name]: '""',
          },
          assertion: "expect(result).toBeDefined()",
        });
      }
    }

    // Boundary conditions for numeric params
    for (const param of signature.params) {
      if (this.isNumericType(param.type)) {
        cases.push({
          description: `should handle zero ${param.name}`,
          inputs: {
            ...this.generateDefaultInputs(signature.params, signature.language),
            [param.name]: "0",
          },
          assertion: "expect(result).toBeDefined()",
        });
        cases.push({
          description: `should handle negative ${param.name}`,
          inputs: {
            ...this.generateDefaultInputs(signature.params, signature.language),
            [param.name]: "-1",
          },
          assertion: "expect(result).toBeDefined()",
        });
      }
    }

    // If doc comment mentions "throws" or "error", add error test
    if (THROWS_ERROR_RE.test(comment)) {
      cases.push({
        description: "should throw on invalid input",
        inputs: this.generateInvalidInputs(
          signature.params,
          signature.language
        ),
        assertion: "expect(() => fn()).toThrow()",
      });
    }

    logger.info(
      { functionName: signature.name, caseCount: cases.length },
      "Generated test cases"
    );

    return cases;
  }

  // -------------------------------------------------------------------------
  // Private helpers
  // -------------------------------------------------------------------------

  private buildSkeleton(
    functionName: string,
    params: FunctionParam[],
    returnType: string,
    language: SupportedLanguage
  ): string {
    switch (language) {
      case "typescript":
        return this.buildTypescriptSkeleton(functionName, params, returnType);
      case "python":
        return this.buildPythonSkeleton(functionName, params, returnType);
      case "rust":
        return this.buildRustSkeleton(functionName, params, returnType);
      case "go":
        return this.buildGoSkeleton(functionName, params, returnType);
      case "java":
        return this.buildJavaSkeleton(functionName, params, returnType);
      default:
        return "// Unsupported language\n";
    }
  }

  private buildTypescriptSkeleton(
    name: string,
    params: FunctionParam[],
    returnType: string
  ): string {
    const paramList = params.map((p) => `${p.name}: ${p.type}`).join(", ");
    return [
      `import { describe, expect, it } from "vitest";`,
      `// import { ${name} } from "./source";`,
      "",
      `describe("${name}", () => {`,
      `  it("should return ${returnType} for valid inputs", () => {`,
      "    // Arrange",
      `    // const result = ${name}(${params.map((p) => this.getDefaultValue(p.type, "typescript")).join(", ")});`,
      "",
      "    // Assert",
      "    // expect(result).toBeDefined();",
      "  });",
      "",
      `  it("should handle edge cases", () => {`,
      `    // TODO: Add edge case tests for ${name}(${paramList})`,
      "  });",
      "});",
      "",
    ].join("\n");
  }

  private buildPythonSkeleton(
    name: string,
    params: FunctionParam[],
    _returnType: string
  ): string {
    const args = params
      .map((p) => this.getDefaultValue(p.type, "python"))
      .join(", ");
    return [
      "import pytest",
      `# from source import ${name}`,
      "",
      "",
      `def test_${name}_valid_input():`,
      `    # result = ${name}(${args})`,
      "    # assert result is not None",
      "    pass",
      "",
      "",
      `def test_${name}_edge_cases():`,
      "    # TODO: Add edge case tests",
      "    pass",
      "",
    ].join("\n");
  }

  private buildRustSkeleton(
    name: string,
    _params: FunctionParam[],
    _returnType: string
  ): string {
    return [
      "#[cfg(test)]",
      "mod tests {",
      "    use super::*;",
      "",
      "    #[test]",
      `    fn test_${name}_valid_input() {`,
      `        // let result = ${name}();`,
      "        // assert!(result.is_ok());",
      "    }",
      "",
      "    #[test]",
      `    fn test_${name}_edge_cases() {`,
      "        // TODO: Add edge case tests",
      "    }",
      "}",
      "",
    ].join("\n");
  }

  private buildGoSkeleton(
    name: string,
    _params: FunctionParam[],
    _returnType: string
  ): string {
    const titleName = name.charAt(0).toUpperCase() + name.slice(1);
    return [
      "package main",
      "",
      `import "testing"`,
      "",
      `func Test${titleName}ValidInput(t *testing.T) {`,
      `	// result := ${name}()`,
      "	// if result == nil {",
      `	// 	t.Fatal("expected non-nil result")`,
      "	// }",
      "}",
      "",
      `func Test${titleName}EdgeCases(t *testing.T) {`,
      "	// TODO: Add edge case tests",
      "}",
      "",
    ].join("\n");
  }

  private buildJavaSkeleton(
    name: string,
    _params: FunctionParam[],
    _returnType: string
  ): string {
    const titleName = name.charAt(0).toUpperCase() + name.slice(1);
    return [
      "import org.junit.jupiter.api.Test;",
      "import static org.junit.jupiter.api.Assertions.*;",
      "",
      `class ${titleName}Test {`,
      "",
      "    @Test",
      "    void shouldReturnValidResult() {",
      `        // var result = ${name}();`,
      "        // assertNotNull(result);",
      "    }",
      "",
      "    @Test",
      "    void shouldHandleEdgeCases() {",
      "        // TODO: Add edge case tests",
      "    }",
      "}",
      "",
    ].join("\n");
  }

  private getDefaultValue(type: string, language: SupportedLanguage): string {
    const lower = type.toLowerCase();
    if (this.isStringType(type)) {
      return language === "python" ? '"test"' : '"test"';
    }
    if (this.isNumericType(type)) {
      return "1";
    }
    if (lower === "boolean" || lower === "bool") {
      return language === "python" ? "True" : "true";
    }
    return language === "python" ? "None" : "undefined";
  }

  private generateDefaultInputs(
    params: FunctionParam[],
    language: SupportedLanguage
  ): Record<string, string> {
    const inputs: Record<string, string> = {};
    for (const param of params) {
      inputs[param.name] = this.getDefaultValue(param.type, language);
    }
    return inputs;
  }

  private generateInvalidInputs(
    params: FunctionParam[],
    _language: SupportedLanguage
  ): Record<string, string> {
    const inputs: Record<string, string> = {};
    for (const param of params) {
      inputs[param.name] = "undefined";
    }
    return inputs;
  }

  private isNullable(type: string): boolean {
    return NULLABLE_RE.test(type.toLowerCase());
  }

  private isStringType(type: string): boolean {
    return STRING_TYPE_RE.test(type.trim());
  }

  private isNumericType(type: string): boolean {
    return NUMERIC_TYPE_RE.test(type.trim());
  }
}
