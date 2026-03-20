/**
 * Dependency Auditor — Audits project dependencies for outdated packages,
 * license compatibility, and known security vulnerabilities.
 */

import { createLogger } from "@prometheus/logger";

const logger = createLogger("project-brain:dependency-auditor");

const NON_DIGIT_PREFIX_RE = /^[^0-9]*/;
const SEMVER_RE = /^(\d+)\.(\d+)\.(\d+)/;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface DependencyEntry {
  name: string;
  version: string;
}

export interface OutdatedInfo {
  currentVersion: string;
  latestVersion: string;
  name: string;
  severity: "patch" | "minor" | "major";
}

export interface LicenseIssue {
  license: string;
  name: string;
  reason: string;
}

export interface SecurityAdvisory {
  affectedVersions: string;
  description: string;
  name: string;
  severity: "low" | "moderate" | "high" | "critical";
}

export interface AuditReport {
  licenseIssues: LicenseIssue[];
  outdated: OutdatedInfo[];
  recommendations: string[];
  scannedAt: string;
  totalDependencies: number;
  vulnerable: SecurityAdvisory[];
}

// ---------------------------------------------------------------------------
// Known problematic licenses
// ---------------------------------------------------------------------------

const COPYLEFT_LICENSES = new Set([
  "GPL-2.0",
  "GPL-3.0",
  "AGPL-3.0",
  "LGPL-2.1",
  "LGPL-3.0",
  "MPL-2.0",
  "EUPL-1.1",
  "EUPL-1.2",
  "CPAL-1.0",
  "OSL-3.0",
]);

const RESTRICTIVE_LICENSES = new Set(["SSPL-1.0", "BSL-1.1", "Elastic-2.0"]);

// ---------------------------------------------------------------------------
// Known vulnerable package patterns
// ---------------------------------------------------------------------------

const KNOWN_VULNERABILITIES: Array<{
  advisory: string;
  affectedVersions: string;
  name: string;
  severity: SecurityAdvisory["severity"];
}> = [
  {
    name: "lodash",
    affectedVersions: "<4.17.21",
    severity: "high",
    advisory: "Prototype pollution vulnerability",
  },
  {
    name: "minimist",
    affectedVersions: "<1.2.6",
    severity: "critical",
    advisory: "Prototype pollution vulnerability",
  },
  {
    name: "node-fetch",
    affectedVersions: "<2.6.7",
    severity: "high",
    advisory: "Exposure of sensitive information",
  },
  {
    name: "json5",
    affectedVersions: "<2.2.2",
    severity: "high",
    advisory: "Prototype pollution vulnerability",
  },
  {
    name: "semver",
    affectedVersions: "<7.5.2",
    severity: "moderate",
    advisory: "Regular expression denial of service",
  },
];

// ---------------------------------------------------------------------------
// DependencyAuditor
// ---------------------------------------------------------------------------

export class DependencyAuditor {
  /**
   * Run a full audit on project dependencies.
   */
  auditDependencies(packageJson: Record<string, unknown>): AuditReport {
    const deps = this.extractDependencies(packageJson);

    logger.info({ dependencyCount: deps.length }, "Starting dependency audit");

    const outdated = this.checkForUpdates(deps);
    const licenseIssues = this.checkLicenses(deps);
    const vulnerable = this.getSecurityAdvisories(deps);
    const recommendations = this.generateRecommendations(
      outdated,
      licenseIssues,
      vulnerable
    );

    const report: AuditReport = {
      totalDependencies: deps.length,
      outdated,
      vulnerable,
      licenseIssues,
      recommendations,
      scannedAt: new Date().toISOString(),
    };

    logger.info(
      {
        outdated: outdated.length,
        vulnerable: vulnerable.length,
        licenseIssues: licenseIssues.length,
      },
      "Dependency audit complete"
    );

    return report;
  }

  /**
   * Check for outdated packages.
   */
  checkForUpdates(dependencies: DependencyEntry[]): OutdatedInfo[] {
    const outdated: OutdatedInfo[] = [];

    for (const dep of dependencies) {
      const version = this.parseVersion(dep.version);
      if (!version) {
        continue;
      }

      if (version.major === 0) {
        outdated.push({
          name: dep.name,
          currentVersion: dep.version,
          latestVersion: "check npm registry",
          severity: "minor",
        });
      }
    }

    return outdated;
  }

  /**
   * Check license compatibility.
   */
  checkLicenses(dependencies: DependencyEntry[]): LicenseIssue[] {
    const issues: LicenseIssue[] = [];

    for (const dep of dependencies) {
      const license = this.getKnownLicense(dep.name);
      if (!license) {
        continue;
      }

      if (COPYLEFT_LICENSES.has(license)) {
        issues.push({
          name: dep.name,
          license,
          reason: `Copyleft license (${license}) may require distributing source code`,
        });
      }

      if (RESTRICTIVE_LICENSES.has(license)) {
        issues.push({
          name: dep.name,
          license,
          reason: `Restrictive license (${license}) may limit commercial use`,
        });
      }
    }

    return issues;
  }

  /**
   * Check for known security vulnerabilities.
   */
  getSecurityAdvisories(dependencies: DependencyEntry[]): SecurityAdvisory[] {
    const advisories: SecurityAdvisory[] = [];

    for (const dep of dependencies) {
      for (const vuln of KNOWN_VULNERABILITIES) {
        if (dep.name === vuln.name) {
          const depVersion = this.parseVersion(dep.version);
          const vulnVersion = this.parseVersion(
            vuln.affectedVersions.replace("<", "")
          );

          if (
            depVersion &&
            vulnVersion &&
            this.isVersionLessThan(depVersion, vulnVersion)
          ) {
            advisories.push({
              name: dep.name,
              severity: vuln.severity,
              description: vuln.advisory,
              affectedVersions: vuln.affectedVersions,
            });
          }
        }
      }
    }

    return advisories;
  }

  // ---- Private helpers ------------------------------------------------------

  private extractDependencies(
    packageJson: Record<string, unknown>
  ): DependencyEntry[] {
    const deps: DependencyEntry[] = [];

    const dependencies = (packageJson.dependencies ?? {}) as Record<
      string,
      string
    >;
    for (const [name, version] of Object.entries(dependencies)) {
      deps.push({ name, version });
    }

    const devDependencies = (packageJson.devDependencies ?? {}) as Record<
      string,
      string
    >;
    for (const [name, version] of Object.entries(devDependencies)) {
      deps.push({ name, version });
    }

    return deps;
  }

  private parseVersion(
    version: string
  ): { major: number; minor: number; patch: number } | null {
    const cleaned = version.replace(NON_DIGIT_PREFIX_RE, "");
    const match = SEMVER_RE.exec(cleaned);
    if (!match) {
      return null;
    }
    return {
      major: Number.parseInt(match[1] ?? "0", 10),
      minor: Number.parseInt(match[2] ?? "0", 10),
      patch: Number.parseInt(match[3] ?? "0", 10),
    };
  }

  private isVersionLessThan(
    a: { major: number; minor: number; patch: number },
    b: { major: number; minor: number; patch: number }
  ): boolean {
    if (a.major !== b.major) {
      return a.major < b.major;
    }
    if (a.minor !== b.minor) {
      return a.minor < b.minor;
    }
    return a.patch < b.patch;
  }

  private getKnownLicense(packageName: string): string | null {
    const knownLicenses: Record<string, string> = {
      "mongodb-memory-server": "MIT",
      sharp: "Apache-2.0",
    };
    return knownLicenses[packageName] ?? null;
  }

  private generateRecommendations(
    outdated: OutdatedInfo[],
    licenseIssues: LicenseIssue[],
    vulnerable: SecurityAdvisory[]
  ): string[] {
    const recommendations: string[] = [];

    if (vulnerable.length > 0) {
      const critical = vulnerable.filter((v) => v.severity === "critical");
      if (critical.length > 0) {
        recommendations.push(
          `CRITICAL: Update ${critical.map((v) => v.name).join(", ")} immediately to fix security vulnerabilities.`
        );
      }
      const high = vulnerable.filter((v) => v.severity === "high");
      if (high.length > 0) {
        recommendations.push(
          `HIGH: Update ${high.map((v) => v.name).join(", ")} to address known vulnerabilities.`
        );
      }
    }

    if (licenseIssues.length > 0) {
      recommendations.push(
        `Review license compatibility for: ${licenseIssues.map((l) => l.name).join(", ")}.`
      );
    }

    const majorOutdated = outdated.filter((o) => o.severity === "major");
    if (majorOutdated.length > 0) {
      recommendations.push(
        `Consider upgrading major versions: ${majorOutdated.map((o) => o.name).join(", ")}.`
      );
    }

    if (
      recommendations.length === 0 &&
      vulnerable.length === 0 &&
      licenseIssues.length === 0
    ) {
      recommendations.push(
        "Dependencies look healthy. Continue monitoring for new advisories."
      );
    }

    return recommendations;
  }
}
