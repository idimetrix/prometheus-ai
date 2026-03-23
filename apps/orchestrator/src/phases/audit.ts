import { createLogger } from "@prometheus/logger";
import { EventPublisher, QueueEvents } from "@prometheus/queue";
import type { AgentLoop } from "../agent-loop";

const logger = createLogger("orchestrator:phase:audit");

export interface AuditResult {
  businessLogic: { passed: boolean; findings: string[] };
  overallPassed: boolean;
  performance: { passed: boolean; findings: string[] };
  security: { passed: boolean; findings: string[] };
}

/**
 * Audit Phase runs three parallel sub-audits:
 * 1. Security: OWASP Top 10 checks
 * 2. Performance: N+1 queries, missing indexes, unbounded loops
 * 3. Business logic: verify implementation matches SRS requirements
 */
export class AuditPhase {
  private readonly eventPublisher = new EventPublisher();

  async execute(
    agentLoop: AgentLoop,
    srsContent?: string
  ): Promise<AuditResult> {
    logger.info(
      "Starting Audit phase (security + performance + business logic)"
    );

    // Run all three audits (sequentially since we share agentLoop)
    const securityResult = await this.runSecurityAudit(agentLoop);
    const performanceResult = await this.runPerformanceAudit(agentLoop);
    const businessResult = await this.runBusinessLogicAudit(
      agentLoop,
      srsContent
    );

    const result: AuditResult = {
      security: securityResult,
      performance: performanceResult,
      businessLogic: businessResult,
      overallPassed:
        securityResult.passed &&
        performanceResult.passed &&
        businessResult.passed,
    };

    await this.eventPublisher.publishSessionEvent(agentLoop.getSessionId(), {
      type: QueueEvents.PLAN_UPDATE,
      data: { phase: "audit", ...result },
      timestamp: new Date().toISOString(),
    });

    logger.info(
      {
        securityPassed: result.security.passed,
        performancePassed: result.performance.passed,
        businessLogicPassed: result.businessLogic.passed,
        overall: result.overallPassed,
      },
      "Audit phase complete"
    );

    return result;
  }

  private async runSecurityAudit(
    agentLoop: AgentLoop
  ): Promise<{ passed: boolean; findings: string[] }> {
    const result = await agentLoop.executeTask(
      `Perform a comprehensive security audit. Check for:

1. **Injection**: SQL injection, NoSQL injection, command injection, XSS
2. **Broken Auth**: Missing auth checks, weak session management
3. **Sensitive Data**: Exposed secrets, unencrypted PII, verbose errors
4. **Access Control**: Missing authorization, privilege escalation
5. **Security Misconfiguration**: Default configs, unnecessary features
6. **Vulnerable Dependencies**: Known CVEs in dependencies
7. **Input Validation**: Missing validation, type confusion, buffer overflow

For each finding, report:
FINDING: <description>
SEVERITY: <critical|high|medium|low>
FILE: <file path>
FIX: <suggested fix>`,
      "security_auditor"
    );

    const findings = this.parseFindings(result.output);
    const criticalOrHigh = findings.filter(
      (f) => f.includes("critical") || f.includes("high")
    );

    return { passed: criticalOrHigh.length === 0, findings };
  }

  private async runPerformanceAudit(
    agentLoop: AgentLoop
  ): Promise<{ passed: boolean; findings: string[] }> {
    const result = await agentLoop.executeTask(
      `Perform a performance audit on the codebase. Check for:

1. **N+1 Queries**: Database queries inside loops
2. **Missing Indexes**: Columns used in WHERE/ORDER BY without indexes
3. **Unbounded Loops**: Loops without limits that could process unlimited data
4. **Memory Leaks**: Event listeners not cleaned up, growing arrays/maps
5. **Large Payloads**: API responses without pagination, unlimited list queries
6. **Missing Caching**: Repeated expensive computations without cache
7. **Blocking Operations**: Synchronous I/O in async paths

For each finding, report:
FINDING: <description>
SEVERITY: <critical|high|medium|low>
FILE: <file path>
FIX: <suggested fix>`,
      "backend_coder"
    );

    const findings = this.parseFindings(result.output);
    return { passed: findings.length <= 3, findings };
  }

  private async runBusinessLogicAudit(
    agentLoop: AgentLoop,
    srsContent?: string
  ): Promise<{ passed: boolean; findings: string[] }> {
    const prompt = srsContent
      ? `Verify the implementation matches the SRS requirements:\n\n${srsContent}\n\nFor each requirement, verify it is properly implemented. Report any gaps.`
      : "Review the implementation for business logic correctness. Check that:\n1. All CRUD operations handle edge cases\n2. Authorization logic is consistent\n3. Data validation matches business rules\n4. Error states are properly handled";

    const result = await agentLoop.executeTask(prompt, "test_engineer");

    const findings = this.parseFindings(result.output);
    return { passed: findings.length <= 2, findings };
  }

  private parseFindings(output: string): string[] {
    const findings: string[] = [];
    const matches = output.matchAll(
      /FINDING:\s*(.+?)(?=\nSEVERITY|\nFINDING|$)/gis
    );
    for (const match of matches) {
      if (match[1]?.trim()) {
        findings.push(match[1].trim());
      }
    }
    return findings;
  }
}
