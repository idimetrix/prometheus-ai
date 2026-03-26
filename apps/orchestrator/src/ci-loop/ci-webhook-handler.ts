import { createLogger } from "@prometheus/logger";

const logger = createLogger("orchestrator:ci-loop:webhook");

export interface CIWebhookEvent {
  /** Branch name the check ran on */
  branch: string;
  /** GitHub check run ID */
  checkRunId: number;
  /** Name of the failing check (e.g., "build", "test", "lint") */
  failingCheckName: string;
  /** Full name of the repo (owner/repo) */
  fullRepoName: string;
  /** PR number associated with this check */
  prNumber: number;
}

export interface CheckRunPayload {
  action: string;
  check_run: {
    conclusion: string | null;
    head_sha: string;
    id: number;
    name: string;
    output: {
      summary: string | null;
      text: string | null;
      title: string | null;
    };
    pull_requests: Array<{
      head: { ref: string };
      number: number;
    }>;
  };
  repository: {
    full_name: string;
  };
}

export interface CheckSuitePayload {
  action: string;
  check_suite: {
    conclusion: string | null;
    head_branch: string;
    head_sha: string;
    id: number;
    pull_requests: Array<{
      head: { ref: string };
      number: number;
    }>;
  };
  repository: {
    full_name: string;
  };
}

/**
 * CIWebhookHandler processes GitHub webhook events for CI check failures.
 * It filters for checks on Prometheus-created PRs and extracts structured
 * data for the CI auto-fix loop.
 */
export class CIWebhookHandler {
  private readonly prometheusBranchPrefixes: string[];

  constructor(
    branchPrefixes: string[] = ["claude/", "prometheus/", "auto-fix/"]
  ) {
    this.prometheusBranchPrefixes = branchPrefixes;
  }

  /**
   * Handle a `check_run.completed` event with conclusion=failure.
   * Returns null if the event should be ignored.
   */
  handleCheckRunCompleted(payload: CheckRunPayload): CIWebhookEvent | null {
    const { check_run, repository } = payload;

    if (payload.action !== "completed") {
      return null;
    }

    if (
      check_run.conclusion !== "failure" &&
      check_run.conclusion !== "timed_out"
    ) {
      return null;
    }

    const pr = check_run.pull_requests[0];
    if (!pr) {
      logger.debug(
        { checkRunId: check_run.id },
        "Check run has no associated PR, skipping"
      );
      return null;
    }

    // Only trigger for PRs created by Prometheus
    if (!this.isPrometheusBranch(pr.head.ref)) {
      logger.debug(
        { branch: pr.head.ref, checkRunId: check_run.id },
        "Check run is not on a Prometheus branch, skipping"
      );
      return null;
    }

    const event: CIWebhookEvent = {
      prNumber: pr.number,
      branch: pr.head.ref,
      failingCheckName: check_run.name,
      checkRunId: check_run.id,
      fullRepoName: repository.full_name,
    };

    logger.info(
      {
        prNumber: event.prNumber,
        branch: event.branch,
        checkName: event.failingCheckName,
        repo: event.fullRepoName,
      },
      "CI check_run failure detected on Prometheus PR"
    );

    return event;
  }

  /**
   * Handle a `check_suite.completed` event with conclusion=failure.
   * Returns null if the event should be ignored.
   */
  handleCheckSuiteCompleted(payload: CheckSuitePayload): CIWebhookEvent | null {
    const { check_suite, repository } = payload;

    if (payload.action !== "completed") {
      return null;
    }

    if (
      check_suite.conclusion !== "failure" &&
      check_suite.conclusion !== "timed_out"
    ) {
      return null;
    }

    const pr = check_suite.pull_requests[0];
    if (!pr) {
      logger.debug(
        { suiteId: check_suite.id },
        "Check suite has no associated PR, skipping"
      );
      return null;
    }

    if (!this.isPrometheusBranch(pr.head.ref)) {
      logger.debug(
        { branch: pr.head.ref, suiteId: check_suite.id },
        "Check suite is not on a Prometheus branch, skipping"
      );
      return null;
    }

    const event: CIWebhookEvent = {
      prNumber: pr.number,
      branch: pr.head.ref,
      failingCheckName: `check_suite_${check_suite.id}`,
      checkRunId: check_suite.id,
      fullRepoName: repository.full_name,
    };

    logger.info(
      {
        prNumber: event.prNumber,
        branch: event.branch,
        repo: event.fullRepoName,
      },
      "CI check_suite failure detected on Prometheus PR"
    );

    return event;
  }

  /**
   * Check if a branch was created by Prometheus.
   */
  private isPrometheusBranch(branchName: string): boolean {
    return this.prometheusBranchPrefixes.some((prefix) =>
      branchName.startsWith(prefix)
    );
  }
}
