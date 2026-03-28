/**
 * GAP-080: Automated Security Patching
 *
 * Scans dependencies for known vulnerabilities, generates patches,
 * tests them, and creates PRs with security fixes.
 */

import { createLogger } from "@prometheus/logger";

const logger = createLogger("orchestrator:pipeline:security-patching");

// ─── Types ────────────────────────────────────────────────────────────────────

export interface Vulnerability {
  currentVersion: string;
  cveId?: string;
  description: string;
  fixedVersion: string;
  id: string;
  packageName: string;
  severity: "critical" | "high" | "medium" | "low";
}

export interface PatchResult {
  error?: string;
  patched: boolean;
  patchedVersion: string;
  prUrl?: string;
  testsPass: boolean;
  vulnerability: Vulnerability;
}

export interface SecurityScanResult {
  patches: PatchResult[];
  scannedAt: number;
  totalDependencies: number;
  vulnerabilities: Vulnerability[];
}

type ScanFn = () => Promise<Vulnerability[]>;
type PatchFn = (
  vuln: Vulnerability
) => Promise<{ success: boolean; version: string }>;
type TestFn = () => Promise<boolean>;
type PRFn = (vulns: Vulnerability[]) => Promise<string>;

// ─── Security Patching Pipeline ──────────────────────────────────────────────

export class SecurityPatchingPipeline {
  private readonly scanFn: ScanFn;
  private readonly patchFn: PatchFn;
  private readonly testFn: TestFn;
  private readonly prFn: PRFn;

  constructor(scanFn: ScanFn, patchFn: PatchFn, testFn: TestFn, prFn: PRFn) {
    this.scanFn = scanFn;
    this.patchFn = patchFn;
    this.testFn = testFn;
    this.prFn = prFn;
  }

  /**
   * Run the full security patching pipeline.
   */
  async run(): Promise<SecurityScanResult> {
    logger.info("Starting security patching pipeline");

    // Step 1: Scan for vulnerabilities
    const vulnerabilities = await this.scanFn();
    logger.info(
      { vulnCount: vulnerabilities.length },
      "Vulnerability scan completed"
    );

    if (vulnerabilities.length === 0) {
      return {
        scannedAt: Date.now(),
        totalDependencies: 0,
        vulnerabilities: [],
        patches: [],
      };
    }

    // Step 2: Sort by severity (critical first)
    const sorted = this.sortBySeverity(vulnerabilities);

    // Step 3: Attempt to patch each vulnerability
    const patches: PatchResult[] = [];
    for (const vuln of sorted) {
      try {
        const patchResult = await this.patchFn(vuln);

        if (patchResult.success) {
          // Step 4: Run tests
          const testsPass = await this.testFn();

          patches.push({
            vulnerability: vuln,
            patched: true,
            patchedVersion: patchResult.version,
            testsPass,
          });

          logger.info(
            {
              package: vuln.packageName,
              from: vuln.currentVersion,
              to: patchResult.version,
              testsPass,
            },
            "Vulnerability patched"
          );
        } else {
          patches.push({
            vulnerability: vuln,
            patched: false,
            patchedVersion: vuln.currentVersion,
            testsPass: false,
            error: "Patch failed",
          });
        }
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        patches.push({
          vulnerability: vuln,
          patched: false,
          patchedVersion: vuln.currentVersion,
          testsPass: false,
          error: msg,
        });
        logger.warn(
          { package: vuln.packageName, error: msg },
          "Failed to patch vulnerability"
        );
      }
    }

    // Step 5: Create PR for successful patches
    const successfulPatches = patches.filter((p) => p.patched && p.testsPass);
    if (successfulPatches.length > 0) {
      try {
        const prUrl = await this.prFn(
          successfulPatches.map((p) => p.vulnerability)
        );
        for (const patch of successfulPatches) {
          patch.prUrl = prUrl;
        }
        logger.info(
          { prUrl, patchCount: successfulPatches.length },
          "Security PR created"
        );
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        logger.error({ error: msg }, "Failed to create security PR");
      }
    }

    return {
      scannedAt: Date.now(),
      totalDependencies: vulnerabilities.length,
      vulnerabilities: sorted,
      patches,
    };
  }

  private sortBySeverity(vulns: Vulnerability[]): Vulnerability[] {
    const severityOrder = { critical: 0, high: 1, medium: 2, low: 3 };
    return [...vulns].sort(
      (a, b) => severityOrder[a.severity] - severityOrder[b.severity]
    );
  }
}
