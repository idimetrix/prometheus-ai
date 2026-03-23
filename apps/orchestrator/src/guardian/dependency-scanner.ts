import { createLogger } from "@prometheus/logger";

const logger = createLogger("orchestrator:guardian:dependency-scanner");

const SEMVER_PREFIX_RE = /^[^0-9]*/;
const RANGE_PREFIX_RE = /^[<>=^~!]*/;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type VulnerabilitySeverity = "low" | "moderate" | "high" | "critical";

export interface Vulnerability {
  advisory: string;
  fixedIn: string | null;
  package: string;
  severity: VulnerabilitySeverity;
  version: string;
}

export interface OutdatedPackage {
  current: string;
  latest: string;
  package: string;
  type: "major" | "minor" | "patch";
}

export interface DependencyRecommendation {
  message: string;
  package: string;
  priority: "low" | "medium" | "high";
}

export interface DependencyScanResult {
  outdated: OutdatedPackage[];
  recommendations: DependencyRecommendation[];
  vulnerabilities: Vulnerability[];
}

interface PackageJsonShape {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
}

// ---------------------------------------------------------------------------
// Known vulnerability database (simplified for offline use)
// ---------------------------------------------------------------------------

interface KnownVulnerability {
  advisory: string;
  fixedIn: string;
  package: string;
  severity: VulnerabilitySeverity;
  vulnerableRange: string;
}

const KNOWN_VULNERABILITIES: KnownVulnerability[] = [
  {
    package: "lodash",
    vulnerableRange: "<4.17.21",
    severity: "high",
    advisory: "Prototype pollution in lodash",
    fixedIn: "4.17.21",
  },
  {
    package: "minimist",
    vulnerableRange: "<1.2.6",
    severity: "critical",
    advisory: "Prototype pollution in minimist",
    fixedIn: "1.2.6",
  },
  {
    package: "node-fetch",
    vulnerableRange: "<2.6.7",
    severity: "high",
    advisory: "Exposure of sensitive information in node-fetch",
    fixedIn: "2.6.7",
  },
  {
    package: "jsonwebtoken",
    vulnerableRange: "<9.0.0",
    severity: "moderate",
    advisory: "Insecure default algorithm in jsonwebtoken",
    fixedIn: "9.0.0",
  },
  {
    package: "axios",
    vulnerableRange: "<1.6.0",
    severity: "moderate",
    advisory: "SSRF vulnerability in axios",
    fixedIn: "1.6.0",
  },
  {
    package: "express",
    vulnerableRange: "<4.19.2",
    severity: "moderate",
    advisory: "Open redirect vulnerability in express",
    fixedIn: "4.19.2",
  },
];

// ---------------------------------------------------------------------------
// Deprecated / discouraged packages
// ---------------------------------------------------------------------------

const DISCOURAGED_PACKAGES: Record<
  string,
  { alternative: string; reason: string }
> = {
  request: {
    reason: "Deprecated since 2020",
    alternative: "Use 'undici' or native fetch",
  },
  moment: {
    reason: "In maintenance mode, large bundle size",
    alternative: "Use 'date-fns' or 'dayjs'",
  },
  "node-uuid": {
    reason: "Deprecated",
    alternative: "Use 'uuid' package",
  },
  mkdirp: {
    reason: "Built into Node.js since v10",
    alternative: "Use fs.mkdirSync with { recursive: true }",
  },
  rimraf: {
    reason: "Built into Node.js since v16.11",
    alternative: "Use fs.rmSync with { recursive: true, force: true }",
  },
};

// ---------------------------------------------------------------------------
// DependencyScanner
// ---------------------------------------------------------------------------

/**
 * Scans package.json dependencies for known vulnerabilities, outdated
 * packages, and discouraged dependencies. Provides actionable recommendations.
 */
export class DependencyScanner {
  /**
   * Parse a package.json string and extract all dependencies.
   */
  scanPackageJson(
    content: string
  ): Record<string, { type: string; version: string }> {
    const parsed = JSON.parse(content) as PackageJsonShape;
    const deps: Record<string, { type: string; version: string }> = {};

    for (const [name, version] of Object.entries(parsed.dependencies ?? {})) {
      deps[name] = { version, type: "production" };
    }

    for (const [name, version] of Object.entries(
      parsed.devDependencies ?? {}
    )) {
      deps[name] = { version, type: "dev" };
    }

    for (const [name, version] of Object.entries(
      parsed.peerDependencies ?? {}
    )) {
      if (!deps[name]) {
        deps[name] = { version, type: "peer" };
      }
    }

    logger.info(
      { dependencyCount: Object.keys(deps).length },
      "Parsed package.json dependencies"
    );

    return deps;
  }

  /**
   * Check dependencies against known vulnerabilities.
   */
  checkVulnerabilities(dependencies: Record<string, string>): Vulnerability[] {
    const vulns: Vulnerability[] = [];

    for (const [pkg, version] of Object.entries(dependencies)) {
      const knownVulns = KNOWN_VULNERABILITIES.filter((v) => v.package === pkg);

      for (const vuln of knownVulns) {
        // Simple version comparison: check if the dependency version
        // is within the vulnerable range
        if (this.isVulnerable(version, vuln.vulnerableRange)) {
          vulns.push({
            package: pkg,
            version,
            severity: vuln.severity,
            advisory: vuln.advisory,
            fixedIn: vuln.fixedIn,
          });
        }
      }
    }

    if (vulns.length > 0) {
      logger.warn(
        {
          vulnerabilityCount: vulns.length,
          critical: vulns.filter((v) => v.severity === "critical").length,
          high: vulns.filter((v) => v.severity === "high").length,
        },
        "Vulnerabilities detected in dependencies"
      );
    }

    return vulns;
  }

  /**
   * Flag outdated or deprecated packages.
   */
  getOutdatedPackages(dependencies: Record<string, string>): OutdatedPackage[] {
    const outdated: OutdatedPackage[] = [];

    // Check against discouraged packages list
    for (const [pkg, _version] of Object.entries(dependencies)) {
      if (DISCOURAGED_PACKAGES[pkg]) {
        outdated.push({
          package: pkg,
          current: _version,
          latest: "N/A (deprecated)",
          type: "major",
        });
      }
    }

    return outdated;
  }

  /**
   * Generate recommendations based on scan results.
   */
  getRecommendations(
    dependencies: Record<string, string>
  ): DependencyRecommendation[] {
    const recommendations: DependencyRecommendation[] = [];

    for (const [pkg, _version] of Object.entries(dependencies)) {
      const discouraged = DISCOURAGED_PACKAGES[pkg];
      if (discouraged) {
        recommendations.push({
          package: pkg,
          priority: "medium",
          message: `${discouraged.reason}. ${discouraged.alternative}`,
        });
      }
    }

    // Check for duplicate functionality
    const hasLodash = "lodash" in dependencies;
    const hasUnderscore = "underscore" in dependencies;
    if (hasLodash && hasUnderscore) {
      recommendations.push({
        package: "underscore",
        priority: "low",
        message:
          "Both lodash and underscore are installed. Consider using only one.",
      });
    }

    return recommendations;
  }

  /**
   * Run a full dependency scan and return aggregated results.
   */
  fullScan(packageJsonContent: string): DependencyScanResult {
    const allDeps = this.scanPackageJson(packageJsonContent);
    const flatDeps: Record<string, string> = {};
    for (const [name, info] of Object.entries(allDeps)) {
      flatDeps[name] = info.version;
    }

    return {
      vulnerabilities: this.checkVulnerabilities(flatDeps),
      outdated: this.getOutdatedPackages(flatDeps),
      recommendations: this.getRecommendations(flatDeps),
    };
  }

  // -------------------------------------------------------------------------
  // Private helpers
  // -------------------------------------------------------------------------

  /**
   * Simplified vulnerability range check. Compares cleaned semver versions.
   * In production, use a proper semver library for range evaluation.
   */
  private isVulnerable(version: string, range: string): boolean {
    // Strip semver prefixes (^, ~, >=, etc.)
    const cleanVersion = version.replace(SEMVER_PREFIX_RE, "");
    const rangeVersion = range.replace(RANGE_PREFIX_RE, "");

    // Simple numeric comparison
    const vParts = cleanVersion.split(".").map(Number);
    const rParts = rangeVersion.split(".").map(Number);

    for (let i = 0; i < 3; i++) {
      const v = vParts[i] ?? 0;
      const r = rParts[i] ?? 0;
      if (v < r) {
        return true;
      }
      if (v > r) {
        return false;
      }
    }

    // Equal version -- if range is "<X", then equal is not vulnerable
    return range.startsWith("<=");
  }
}
