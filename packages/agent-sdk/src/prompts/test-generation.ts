/**
 * Test Generation Prompts — GAP-028
 *
 * Prompts and utilities for generating comprehensive test suites
 * from source code. Supports multiple test frameworks and languages.
 */

export const TEST_GENERATION_PROMPT = `Generate comprehensive tests for the provided source code. Your tests should cover:

1. **Happy Path**: Test the primary use case with typical inputs
2. **Edge Cases**: Test boundary values, empty inputs, null/undefined, max values
3. **Error Cases**: Test invalid inputs, expected exceptions, error states
4. **Integration**: If the code interacts with other modules, test those interactions

## Test Quality Guidelines
- Each test should have a single, clear assertion
- Use descriptive test names that explain the expected behavior: "should return empty array when no items match"
- Avoid testing implementation details; test the public API surface
- Include setup/teardown for shared state
- Mock external dependencies (database, API calls, file system)
- Test async error handling paths
- Include type-level tests where applicable (TypeScript)

## Output Format
Provide a complete, runnable test file with:
- Proper imports for the test framework and the module under test
- Describe blocks grouping related tests
- Individual test cases with clear assertions
- Helper functions or fixtures if needed`;

// ---------------------------------------------------------------------------
// Test Framework Detection
// ---------------------------------------------------------------------------

/** Configuration file patterns for each test framework */
const FRAMEWORK_INDICATORS: Record<string, string[]> = {
  vitest: [
    "vitest.config.ts",
    "vitest.config.js",
    "vitest.config.mts",
    "vite.config.ts",
  ],
  jest: [
    "jest.config.ts",
    "jest.config.js",
    "jest.config.mjs",
    "jest.setup.ts",
    "jest.setup.js",
  ],
  pytest: ["pytest.ini", "pyproject.toml", "conftest.py", "setup.cfg"],
  "go test": ["go.mod", "go.sum"],
  "cargo test": ["Cargo.toml", "Cargo.lock"],
  rspec: ["Gemfile", ".rspec", "spec/spec_helper.rb"],
  mocha: ["mocharc.yml", ".mocharc.json", ".mocharc.js"],
};

/** Package.json dependency indicators */
const _PACKAGE_JSON_INDICATORS: Record<string, string[]> = {
  vitest: ["vitest", "@vitest/coverage-v8"],
  jest: ["jest", "@jest/core", "ts-jest"],
  mocha: ["mocha", "@types/mocha"],
};

/**
 * Detect the test framework used in a project from its file listing.
 * Returns the framework name (e.g., "vitest", "jest", "pytest").
 */
export function detectTestFramework(files: string[]): string {
  // Check for framework-specific config files
  for (const [framework, indicators] of Object.entries(FRAMEWORK_INDICATORS)) {
    for (const indicator of indicators) {
      if (files.some((f) => f.endsWith(indicator))) {
        return framework;
      }
    }
  }

  // Check for test file patterns to infer framework
  const hasTestTs = files.some(
    (f) => f.endsWith(".test.ts") || f.endsWith(".spec.ts")
  );
  const hasTestPy = files.some(
    (f) => f.startsWith("test_") || f.endsWith("_test.py")
  );
  const hasTestGo = files.some((f) => f.endsWith("_test.go"));
  const hasTestRs = files.some((f) => f.endsWith(".rs") && f.includes("test"));

  if (hasTestGo) {
    return "go test";
  }
  if (hasTestRs) {
    return "cargo test";
  }
  if (hasTestPy) {
    return "pytest";
  }
  if (hasTestTs) {
    return "vitest"; // Default for TS projects
  }

  return "vitest"; // Safe default
}

// ---------------------------------------------------------------------------
// Prompt Builder
// ---------------------------------------------------------------------------

interface TestPromptContext {
  /** Test framework to use */
  framework: string;
  /** Programming language */
  language: string;
  /** Testing library (e.g., "testing-library", "enzyme") */
  testFramework: string;
}

/**
 * Build a complete test generation prompt from source code and context.
 * The returned prompt includes the system instruction, source code,
 * and framework-specific guidance.
 */
export function buildTestPrompt(
  sourceCode: string,
  context: TestPromptContext
): string {
  const sections: string[] = [];

  sections.push(TEST_GENERATION_PROMPT);

  sections.push("\n## Language and Framework");
  sections.push(`- **Language:** ${context.language}`);
  sections.push(`- **Test Framework:** ${context.testFramework}`);

  // Add framework-specific guidance
  const frameworkGuidance = getFrameworkGuidance(context.testFramework);
  if (frameworkGuidance) {
    sections.push("\n## Framework-Specific Guidelines");
    sections.push(frameworkGuidance);
  }

  sections.push("\n## Source Code to Test");
  sections.push(`\`\`\`${context.language}`);
  sections.push(sourceCode);
  sections.push("```");

  sections.push(
    "\nGenerate a complete test file. Include all necessary imports and ensure every test has meaningful assertions."
  );

  return sections.join("\n");
}

/**
 * Get framework-specific test writing guidance.
 */
function getFrameworkGuidance(framework: string): string {
  switch (framework) {
    case "vitest":
      return `- Use \`describe\`, \`it\`, and \`expect\` from vitest
- Use \`vi.fn()\` for mock functions and \`vi.spyOn()\` for spies
- Use \`beforeEach\` / \`afterEach\` for setup and cleanup
- Use \`vi.mock()\` for module mocking
- Prefer \`toEqual\` for deep equality, \`toBe\` for reference/primitive equality`;

    case "jest":
      return `- Use \`describe\`, \`it\`, and \`expect\` from jest
- Use \`jest.fn()\` for mock functions
- Use \`jest.mock()\` for module mocking
- Use \`beforeEach\` / \`afterEach\` for setup and cleanup`;

    case "pytest":
      return `- Use \`def test_\` prefix for test functions
- Use \`@pytest.fixture\` for shared test data
- Use \`pytest.raises()\` for exception testing
- Use \`assert\` for assertions (not unittest.TestCase)
- Use \`monkeypatch\` fixture for mocking`;

    case "go test":
      return `- Use \`func Test\` prefix with \`*testing.T\` parameter
- Use table-driven tests for multiple cases
- Use \`t.Run()\` for subtests
- Use \`t.Fatal()\` and \`t.Errorf()\` for failures
- Use testify/assert for cleaner assertions if available`;

    case "cargo test":
      return `- Use \`#[test]\` attribute for test functions
- Use \`assert!\`, \`assert_eq!\`, \`assert_ne!\` macros
- Use \`#[should_panic]\` for expected panics
- Use \`#[cfg(test)]\` module for test-only code`;

    default:
      return "";
  }
}
