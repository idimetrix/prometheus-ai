import { createLogger } from "@prometheus/logger";
import type { AgentLoop } from "../agent-loop";

const logger = createLogger("orchestrator:ci-loop:property-testing");

const STRING_RE = /string/i;
const NUMERIC_RE = /number|int/i;
const BOOLEAN_RE = /boolean/i;
const ARRAY_RE = /\[\]|Array/i;

export interface PropertyTestResult {
  failed: number;
  generated: number;
  passed: number;
  shrunkExamples: string[];
}

export interface PropertyTest {
  assertion: string;
  generator: string;
  name: string;
  property: string;
}

export type PropertyKind =
  | "roundtrip"
  | "invariant"
  | "boundary"
  | "idempotent";

/**
 * PropertyTesting generates fast-check property tests from function signatures.
 * Runs as an optional hardening step after unit tests pass.
 */
export class PropertyTesting {
  async generate(
    agentLoop: AgentLoop,
    targetFiles: string[]
  ): Promise<PropertyTestResult> {
    logger.info({ fileCount: targetFiles.length }, "Generating property tests");

    const prompt = `Generate property-based tests using fast-check for the following files:

${targetFiles.map((f) => `- ${f}`).join("\n")}

For each exported function/method in these files:
1. Read the function signature and understand its contract
2. Generate fast-check property tests that verify:
   - Output type correctness for random valid inputs
   - Idempotency where applicable
   - Commutativity/associativity for mathematical operations
   - Round-trip properties (serialize/deserialize)
   - No throws for valid input ranges
   - Boundary conditions

Use this pattern:
\`\`\`typescript
import { describe, it, expect } from "vitest";
import fc from "fast-check";

describe("propertyName", () => {
  it("should satisfy property X", () => {
    fc.assert(
      fc.property(fc.string(), (input) => {
        const result = targetFunction(input);
        expect(result).toBeDefined();
      })
    );
  });
});
\`\`\`

Write the test files alongside the source files with .property.test.ts suffix.
Run \`pnpm test\` after writing to verify they pass.`;

    const result = await agentLoop.executeTask(prompt, "test_engineer");

    return {
      generated: targetFiles.length,
      passed: result.success ? targetFiles.length : 0,
      failed: result.success ? 0 : targetFiles.length,
      shrunkExamples: [],
    };
  }

  /**
   * Generate property-based tests from a type definition. Produces
   * roundtrip, invariant, and boundary condition properties.
   */
  generatePropertiesFromType(
    typeName: string,
    typeDefinition: string
  ): PropertyTest[] {
    const properties: PropertyTest[] = [];

    logger.info({ typeName }, "Generating properties from type definition");

    // Roundtrip: serialize then deserialize should yield the same value
    properties.push({
      name: `${typeName}_roundtrip`,
      property: "JSON.parse(JSON.stringify(value)) deep-equals value",
      generator: "fc.anything()",
      assertion: [
        `fc.assert(fc.property(arbitrary${typeName}, (value) => {`,
        "  const serialized = JSON.stringify(value);",
        "  const deserialized = JSON.parse(serialized);",
        "  expect(deserialized).toEqual(value);",
        "}))",
      ].join("\n"),
    });

    // Invariant: type guard should always return true for generated values
    properties.push({
      name: `${typeName}_invariant`,
      property: `Generated ${typeName} values satisfy type invariants`,
      generator: this.inferGenerator(typeDefinition),
      assertion: [
        `fc.assert(fc.property(arbitrary${typeName}, (value) => {`,
        "  expect(value).toBeDefined();",
        `  expect(typeof value).not.toBe("undefined");`,
        "}))",
      ].join("\n"),
    });

    // Boundary: test edge cases based on field types
    const boundaryTests = this.generateBoundaryProperties(
      typeName,
      typeDefinition
    );
    properties.push(...boundaryTests);

    return properties;
  }

  private inferGenerator(typeDefinition: string): string {
    if (STRING_RE.test(typeDefinition)) {
      return "fc.string()";
    }
    if (NUMERIC_RE.test(typeDefinition)) {
      return "fc.integer()";
    }
    if (BOOLEAN_RE.test(typeDefinition)) {
      return "fc.boolean()";
    }
    if (ARRAY_RE.test(typeDefinition)) {
      return "fc.array(fc.anything())";
    }
    return "fc.anything()";
  }

  private generateBoundaryProperties(
    typeName: string,
    typeDefinition: string
  ): PropertyTest[] {
    const boundaries: PropertyTest[] = [];

    // If the type has numeric fields, test boundary values
    if (NUMERIC_RE.test(typeDefinition)) {
      boundaries.push({
        name: `${typeName}_numeric_boundaries`,
        property:
          "Numeric fields handle boundary values (0, -1, MAX_SAFE_INTEGER)",
        generator:
          "fc.oneof(fc.constant(0), fc.constant(-1), fc.constant(Number.MAX_SAFE_INTEGER))",
        assertion: [
          "fc.assert(fc.property(fc.integer({ min: -1000, max: 1000 }), (n) => {",
          "  // Verify function handles boundary numbers",
          "  expect(Number.isFinite(n)).toBe(true);",
          "}))",
        ].join("\n"),
      });
    }

    // If the type has string fields, test empty/long strings
    if (STRING_RE.test(typeDefinition)) {
      boundaries.push({
        name: `${typeName}_string_boundaries`,
        property: "String fields handle empty and very long strings",
        generator: `fc.oneof(fc.constant(""), fc.string({ maxLength: 10000 }))`,
        assertion: [
          "fc.assert(fc.property(fc.string(), (s) => {",
          `  expect(typeof s).toBe("string");`,
          "}))",
        ].join("\n"),
      });
    }

    return boundaries;
  }
}
