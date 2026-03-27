"use client";

import {
  Badge,
  Button,
  Card,
  ScrollArea,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@prometheus/ui";
import {
  Check,
  ClipboardCopy,
  FileCode,
  Loader2,
  Play,
  TestTube2,
} from "lucide-react";
import { useCallback, useMemo, useState } from "react";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type TestFramework = "vitest" | "jest" | "mocha";
type GenerationStatus = "idle" | "generating" | "done" | "error";

interface TestFile {
  coverage: number;
  framework: TestFramework;
  path: string;
  testCount: number;
}

interface GeneratedTest {
  code: string;
  framework: TestFramework;
  sourceFile: string;
  testCount: number;
}

interface TestGenerationPanelProps {
  className?: string;
  onGenerate?: (
    sourceFile: string,
    framework: TestFramework,
    coverage: number
  ) => void;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const FRAMEWORKS: Array<{ label: string; value: TestFramework }> = [
  { value: "vitest", label: "Vitest" },
  { value: "jest", label: "Jest" },
  { value: "mocha", label: "Mocha" },
];

const FRAMEWORK_COLORS: Record<TestFramework, string> = {
  vitest: "bg-green-500/20 text-green-400",
  jest: "bg-red-500/20 text-red-400",
  mocha: "bg-yellow-500/20 text-yellow-400",
};

const COVERAGE_STEPS = [50, 60, 70, 80, 90, 100];

// ---------------------------------------------------------------------------
// Mock data
// ---------------------------------------------------------------------------

const MOCK_SOURCE_FILES: TestFile[] = [
  {
    path: "src/routers/projects.ts",
    framework: "vitest",
    testCount: 0,
    coverage: 0,
  },
  {
    path: "src/routers/sessions.ts",
    framework: "vitest",
    testCount: 3,
    coverage: 42,
  },
  {
    path: "src/utils/validators.ts",
    framework: "vitest",
    testCount: 8,
    coverage: 78,
  },
  { path: "src/lib/auth.ts", framework: "vitest", testCount: 2, coverage: 25 },
  {
    path: "src/middleware/rate-limit.ts",
    framework: "vitest",
    testCount: 0,
    coverage: 0,
  },
  {
    path: "src/services/billing.ts",
    framework: "vitest",
    testCount: 5,
    coverage: 60,
  },
];

const MOCK_GENERATED_CODE = `import { describe, expect, it, vi } from "vitest";
import { projectsRouter } from "../routers/projects";
import { createTestContext } from "./helpers";

describe("projectsRouter", () => {
  describe("list", () => {
    it("should return projects for the authenticated org", async () => {
      const ctx = createTestContext({ orgId: "org_test" });
      const caller = projectsRouter.createCaller(ctx);

      const result = await caller.list({ limit: 10 });

      expect(result.projects).toBeDefined();
      expect(Array.isArray(result.projects)).toBe(true);
    });

    it("should respect the limit parameter", async () => {
      const ctx = createTestContext({ orgId: "org_test" });
      const caller = projectsRouter.createCaller(ctx);

      const result = await caller.list({ limit: 5 });

      expect(result.projects.length).toBeLessThanOrEqual(5);
    });

    it("should handle cursor-based pagination", async () => {
      const ctx = createTestContext({ orgId: "org_test" });
      const caller = projectsRouter.createCaller(ctx);

      const first = await caller.list({ limit: 2 });
      if (first.nextCursor) {
        const second = await caller.list({
          limit: 2,
          cursor: first.nextCursor,
        });
        expect(second.projects).toBeDefined();
      }
    });
  });

  describe("get", () => {
    it("should return a project by ID", async () => {
      const ctx = createTestContext({ orgId: "org_test" });
      const caller = projectsRouter.createCaller(ctx);

      const result = await caller.get({ projectId: "proj_001" });

      expect(result).toBeDefined();
      expect(result.id).toBe("proj_001");
    });

    it("should throw NOT_FOUND for non-existent project", async () => {
      const ctx = createTestContext({ orgId: "org_test" });
      const caller = projectsRouter.createCaller(ctx);

      await expect(
        caller.get({ projectId: "proj_nonexistent" })
      ).rejects.toThrow("NOT_FOUND");
    });
  });

  describe("create", () => {
    it("should create a new project", async () => {
      const ctx = createTestContext({ orgId: "org_test" });
      const caller = projectsRouter.createCaller(ctx);

      const result = await caller.create({
        name: "Test Project",
        repoUrl: "https://github.com/test/repo",
      });

      expect(result.id).toBeDefined();
      expect(result.name).toBe("Test Project");
    });
  });
});`;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getCoverageColor(coverage: number): string {
  if (coverage >= 80) {
    return "text-green-400";
  }
  if (coverage >= 50) {
    return "text-yellow-400";
  }
  return "text-red-400";
}

function getCoverageBg(coverage: number): string {
  if (coverage >= 80) {
    return "bg-green-500";
  }
  if (coverage >= 50) {
    return "bg-yellow-500";
  }
  return "bg-red-500";
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function TestGenerationPanel({
  className,
  onGenerate,
}: TestGenerationPanelProps) {
  const [selectedFile, setSelectedFile] = useState<string>(
    MOCK_SOURCE_FILES[0]?.path ?? ""
  );
  const [framework, setFramework] = useState<TestFramework>("vitest");
  const [coverageTarget, setCoverageTarget] = useState(80);
  const [status, setStatus] = useState<GenerationStatus>("idle");
  const [generatedTest, setGeneratedTest] = useState<GeneratedTest | null>(
    null
  );
  const [copied, setCopied] = useState(false);

  const selectedFileInfo = useMemo(
    () => MOCK_SOURCE_FILES.find((f) => f.path === selectedFile),
    [selectedFile]
  );

  const handleGenerate = useCallback(() => {
    setStatus("generating");
    onGenerate?.(selectedFile, framework, coverageTarget);

    // Simulate generation delay
    setTimeout(() => {
      setGeneratedTest({
        sourceFile: selectedFile,
        framework,
        code: MOCK_GENERATED_CODE,
        testCount: 5,
      });
      setStatus("done");
    }, 2000);
  }, [selectedFile, framework, coverageTarget, onGenerate]);

  const handleCopy = useCallback(() => {
    if (generatedTest) {
      navigator.clipboard.writeText(generatedTest.code).catch(() => {
        // Silently fail if clipboard not available
      });
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  }, [generatedTest]);

  return (
    <Card
      className={`flex flex-col border-zinc-800 bg-zinc-950 ${className ?? ""}`}
    >
      {/* Header */}
      <div className="flex items-center gap-2 border-zinc-800 border-b px-4 py-3">
        <TestTube2 className="h-4 w-4 text-violet-400" />
        <h3 className="font-medium text-sm text-zinc-200">Test Generation</h3>
      </div>

      <ScrollArea className="flex-1">
        <div className="space-y-4 p-4">
          {/* File selector */}
          <div>
            <label
              className="mb-1.5 block text-xs text-zinc-400"
              htmlFor="test-source-file"
            >
              Source File
            </label>
            <Select onValueChange={setSelectedFile} value={selectedFile}>
              <SelectTrigger
                className="border-zinc-800 bg-zinc-900"
                id="test-source-file"
              >
                <SelectValue placeholder="Select a file..." />
              </SelectTrigger>
              <SelectContent>
                {MOCK_SOURCE_FILES.map((file) => (
                  <SelectItem key={file.path} value={file.path}>
                    <div className="flex items-center gap-2">
                      <FileCode className="h-3 w-3 text-zinc-500" />
                      <span className="font-mono text-xs">{file.path}</span>
                      {file.coverage > 0 && (
                        <span
                          className={`text-[10px] ${getCoverageColor(file.coverage)}`}
                        >
                          {file.coverage}%
                        </span>
                      )}
                    </div>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            {/* Current coverage indicator */}
            {selectedFileInfo && (
              <div className="mt-2 flex items-center gap-2 text-[10px] text-zinc-500">
                <span>Current coverage:</span>
                <span className={getCoverageColor(selectedFileInfo.coverage)}>
                  {selectedFileInfo.coverage}%
                </span>
                <span>({selectedFileInfo.testCount} existing tests)</span>
              </div>
            )}
          </div>

          {/* Framework selector */}
          <div>
            <label
              className="mb-1.5 block text-xs text-zinc-400"
              htmlFor="test-framework"
            >
              Test Framework
            </label>
            <Select
              onValueChange={(v) => setFramework(v as TestFramework)}
              value={framework}
            >
              <SelectTrigger
                className="border-zinc-800 bg-zinc-900"
                id="test-framework"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {FRAMEWORKS.map((fw) => (
                  <SelectItem key={fw.value} value={fw.value}>
                    <div className="flex items-center gap-2">
                      <Badge
                        className={FRAMEWORK_COLORS[fw.value]}
                        variant="secondary"
                      >
                        {fw.label}
                      </Badge>
                    </div>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Coverage target slider */}
          <div>
            <div className="mb-1.5 flex items-center justify-between">
              <label
                className="text-xs text-zinc-400"
                htmlFor="coverage-target"
              >
                Coverage Target
              </label>
              <span className="font-mono text-violet-400 text-xs">
                {coverageTarget}%
              </span>
            </div>
            <div className="flex items-center gap-2">
              {COVERAGE_STEPS.map((step) => (
                <button
                  className={`flex-1 rounded py-1 text-center text-[10px] transition-colors ${
                    coverageTarget === step
                      ? "bg-violet-500/20 font-medium text-violet-400"
                      : "bg-zinc-900 text-zinc-500 hover:text-zinc-300"
                  }`}
                  key={step}
                  onClick={() => setCoverageTarget(step)}
                  type="button"
                >
                  {step}%
                </button>
              ))}
            </div>
            {/* Visual bar */}
            <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-zinc-800">
              <div
                className={`h-full rounded-full transition-all ${getCoverageBg(coverageTarget)}`}
                style={{ width: `${coverageTarget}%` }}
              />
            </div>
          </div>

          {/* Generate button */}
          <Button
            className="w-full"
            disabled={status === "generating" || !selectedFile}
            onClick={handleGenerate}
          >
            {status === "generating" ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Generating Tests...
              </>
            ) : (
              <>
                <Play className="mr-2 h-4 w-4" />
                Generate Tests
              </>
            )}
          </Button>

          {/* Generated output */}
          {generatedTest && status === "done" && (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Badge
                    className="bg-green-500/20 text-green-400"
                    variant="secondary"
                  >
                    {generatedTest.testCount} tests generated
                  </Badge>
                  <Badge
                    className={FRAMEWORK_COLORS[generatedTest.framework]}
                    variant="secondary"
                  >
                    {generatedTest.framework}
                  </Badge>
                </div>
                <Button
                  className="h-7 text-xs"
                  onClick={handleCopy}
                  size="sm"
                  variant="ghost"
                >
                  {copied ? (
                    <Check className="mr-1 h-3 w-3 text-green-400" />
                  ) : (
                    <ClipboardCopy className="mr-1 h-3 w-3" />
                  )}
                  {copied ? "Copied" : "Copy"}
                </Button>
              </div>

              <pre className="max-h-80 overflow-auto rounded-lg border border-zinc-800 bg-zinc-900 p-3 font-mono text-[11px] text-zinc-300 leading-relaxed">
                {generatedTest.code}
              </pre>
            </div>
          )}
        </div>
      </ScrollArea>
    </Card>
  );
}
