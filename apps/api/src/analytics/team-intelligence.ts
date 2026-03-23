import { createLogger } from "@prometheus/logger";

const logger = createLogger("api:team-intelligence");

const PROJECT_BRAIN_URL =
  process.env.PROJECT_BRAIN_URL ?? "http://localhost:4003";
const API_URL = process.env.API_URL ?? "http://localhost:4000";

export interface DeveloperMetrics {
  avgQualityScore: number;
  avgTaskDuration: number;
  mostProductiveHours: number[];
  preferredAgentRoles: string[];
  tasksCompleted: number;
  topSkills: string[];
  userId: string;
}

export interface TeamPattern {
  confidence: number;
  description: string;
  pattern: string;
  sampleSize: number;
  teamId: string;
}

export interface SprintAnalytics {
  agentUtilization: Record<string, number>;
  avgCostPerTask: number;
  completedTasks: number;
  estimatedVsActual: { estimated: number; actual: number; accuracy: number };
  sprintId: string;
  topPatterns: TeamPattern[];
  totalCreditsUsed: number;
  totalTasks: number;
}

export interface OnboardingContext {
  answer: string;
  confidence: number;
  question: string;
  sources: Array<{ filePath: string; relevance: number }>;
}

interface TaskRecord {
  agentRole: string;
  completedAt: string;
  createdAt: string;
  creditsUsed: number;
  durationMs: number;
  estimatedCredits: number;
  id: string;
  qualityScore: number;
  status: string;
  taskType: string;
  userId: string;
}

interface PatternRecord {
  confidence: number;
  description: string;
  pattern: string;
  sampleSize: number;
  teamId: string;
}

interface BrainQueryResponse {
  answer: string;
  confidence: number;
  sources: Array<{ filePath: string; relevance: number }>;
}

const REQUEST_TIMEOUT_MS = 15_000;
const LONG_REQUEST_TIMEOUT_MS = 30_000;

export class TeamIntelligence {
  private readonly projectBrainUrl: string;
  private readonly apiUrl: string;

  constructor(opts?: { projectBrainUrl?: string; apiUrl?: string }) {
    this.projectBrainUrl = opts?.projectBrainUrl ?? PROJECT_BRAIN_URL;
    this.apiUrl = opts?.apiUrl ?? API_URL;
  }

  /**
   * Get developer productivity metrics. Opt-in and privacy-first:
   * only returns data for the requesting user within their org.
   */
  async getDeveloperMetrics(
    userId: string,
    orgId: string
  ): Promise<DeveloperMetrics> {
    try {
      const params = new URLSearchParams({ userId, orgId });
      const response = await fetch(
        `${this.apiUrl}/internal/analytics/developer-metrics?${params.toString()}`,
        {
          method: "GET",
          headers: { "Content-Type": "application/json" },
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        }
      );

      if (!response.ok) {
        throw new Error(`Developer metrics request failed: ${response.status}`);
      }

      const tasks = (await response.json()) as TaskRecord[];

      return this.computeDeveloperMetrics(userId, tasks);
    } catch (err: unknown) {
      logger.error({ err, userId, orgId }, "Failed to get developer metrics");

      return {
        userId,
        tasksCompleted: 0,
        avgTaskDuration: 0,
        avgQualityScore: 0,
        preferredAgentRoles: [],
        mostProductiveHours: [],
        topSkills: [],
      };
    }
  }

  /**
   * Discover team-level patterns from historical task data.
   */
  async analyzeTeamPatterns(orgId: string): Promise<TeamPattern[]> {
    try {
      const params = new URLSearchParams({ orgId });
      const response = await fetch(
        `${this.apiUrl}/internal/analytics/team-patterns?${params.toString()}`,
        {
          method: "GET",
          headers: { "Content-Type": "application/json" },
          signal: AbortSignal.timeout(LONG_REQUEST_TIMEOUT_MS),
        }
      );

      if (!response.ok) {
        throw new Error(`Team patterns request failed: ${response.status}`);
      }

      const records = (await response.json()) as PatternRecord[];

      return records.map((record) => ({
        teamId: record.teamId,
        pattern: record.pattern,
        description: record.description,
        confidence: record.confidence,
        sampleSize: record.sampleSize,
      }));
    } catch (err: unknown) {
      logger.error({ err, orgId }, "Failed to analyze team patterns");
      return [];
    }
  }

  /**
   * Generate sprint analytics with cost tracking and agent utilization.
   */
  async getSprintAnalytics(
    orgId: string,
    sprintId: string
  ): Promise<SprintAnalytics> {
    try {
      const params = new URLSearchParams({ orgId, sprintId });
      const response = await fetch(
        `${this.apiUrl}/internal/analytics/sprint?${params.toString()}`,
        {
          method: "GET",
          headers: { "Content-Type": "application/json" },
          signal: AbortSignal.timeout(LONG_REQUEST_TIMEOUT_MS),
        }
      );

      if (!response.ok) {
        throw new Error(`Sprint analytics request failed: ${response.status}`);
      }

      const tasks = (await response.json()) as TaskRecord[];

      return this.computeSprintAnalytics(sprintId, orgId, tasks);
    } catch (err: unknown) {
      logger.error({ err, orgId, sprintId }, "Failed to get sprint analytics");

      return {
        sprintId,
        totalTasks: 0,
        completedTasks: 0,
        totalCreditsUsed: 0,
        avgCostPerTask: 0,
        agentUtilization: {},
        estimatedVsActual: { estimated: 0, actual: 0, accuracy: 0 },
        topPatterns: [],
      };
    }
  }

  /**
   * Answer onboarding questions about the codebase using Project Brain.
   */
  async askCodebase(
    projectId: string,
    question: string
  ): Promise<OnboardingContext> {
    try {
      const response = await fetch(
        `${this.projectBrainUrl}/api/projects/${projectId}/query`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ question }),
          signal: AbortSignal.timeout(LONG_REQUEST_TIMEOUT_MS),
        }
      );

      if (!response.ok) {
        throw new Error(`Project Brain query failed: ${response.status}`);
      }

      const data = (await response.json()) as BrainQueryResponse;

      logger.info(
        {
          projectId,
          confidence: data.confidence,
          sourceCount: data.sources.length,
        },
        "Codebase question answered"
      );

      return {
        question,
        answer: data.answer,
        sources: data.sources,
        confidence: data.confidence,
      };
    } catch (err: unknown) {
      logger.error(
        { err, projectId, question: question.slice(0, 100) },
        "Failed to query codebase"
      );

      return {
        question,
        answer:
          "Unable to answer this question at the moment. Please try again later.",
        sources: [],
        confidence: 0,
      };
    }
  }

  /**
   * Share successful patterns from one organization to another.
   * Returns the number of patterns shared.
   */
  async sharePatterns(
    fromOrgId: string,
    toOrgId: string,
    patternIds: string[]
  ): Promise<number> {
    if (patternIds.length === 0) {
      return 0;
    }

    try {
      const response = await fetch(
        `${this.apiUrl}/internal/analytics/share-patterns`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ fromOrgId, toOrgId, patternIds }),
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        }
      );

      if (!response.ok) {
        throw new Error(`Share patterns request failed: ${response.status}`);
      }

      const result = (await response.json()) as { shared: number };

      logger.info(
        { fromOrgId, toOrgId, shared: result.shared },
        "Patterns shared between organizations"
      );

      return result.shared;
    } catch (err: unknown) {
      logger.error(
        { err, fromOrgId, toOrgId, patternCount: patternIds.length },
        "Failed to share patterns"
      );
      return 0;
    }
  }

  /**
   * Generate a knowledge transfer summary for a new team member,
   * tailored to their role (e.g., "frontend", "backend", "devops").
   */
  async generateOnboardingGuide(
    projectId: string,
    role: string
  ): Promise<string> {
    try {
      const response = await fetch(
        `${this.projectBrainUrl}/api/projects/${projectId}/onboarding`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ role }),
          signal: AbortSignal.timeout(LONG_REQUEST_TIMEOUT_MS),
        }
      );

      if (!response.ok) {
        throw new Error(
          `Onboarding guide generation failed: ${response.status}`
        );
      }

      const data = (await response.json()) as { guide: string };

      logger.info(
        { projectId, role, guideLength: data.guide.length },
        "Onboarding guide generated"
      );

      return data.guide;
    } catch (err: unknown) {
      logger.error(
        { err, projectId, role },
        "Failed to generate onboarding guide"
      );

      return `Unable to generate onboarding guide for the "${role}" role at this time. Please try again later.`;
    }
  }

  // ── Private helpers ─────────────────────────────────────────────────────────

  private computeDeveloperMetrics(
    userId: string,
    tasks: TaskRecord[]
  ): DeveloperMetrics {
    const completedTasks = tasks.filter((t) => t.status === "completed");
    const totalDuration = completedTasks.reduce(
      (sum, t) => sum + t.durationMs,
      0
    );
    const totalQuality = completedTasks.reduce(
      (sum, t) => sum + t.qualityScore,
      0
    );

    // Count agent role frequency
    const roleCounts = new Map<string, number>();
    for (const task of completedTasks) {
      const current = roleCounts.get(task.agentRole) ?? 0;
      roleCounts.set(task.agentRole, current + 1);
    }

    const sortedRoles = [...roleCounts.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([role]) => role);

    // Determine productive hours from task creation timestamps
    const hourCounts = new Map<number, number>();
    for (const task of completedTasks) {
      const hour = new Date(task.createdAt).getUTCHours();
      const current = hourCounts.get(hour) ?? 0;
      hourCounts.set(hour, current + 1);
    }

    const sortedHours = [...hourCounts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([hour]) => hour);

    // Infer skills from task types
    const skillCounts = new Map<string, number>();
    for (const task of completedTasks) {
      const current = skillCounts.get(task.taskType) ?? 0;
      skillCounts.set(task.taskType, current + 1);
    }

    const topSkills = [...skillCounts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([skill]) => skill);

    const taskCount = completedTasks.length;

    return {
      userId,
      tasksCompleted: taskCount,
      avgTaskDuration: taskCount > 0 ? totalDuration / taskCount : 0,
      avgQualityScore: taskCount > 0 ? totalQuality / taskCount : 0,
      preferredAgentRoles: sortedRoles.slice(0, 5),
      mostProductiveHours: sortedHours,
      topSkills,
    };
  }

  private async computeSprintAnalytics(
    sprintId: string,
    orgId: string,
    tasks: TaskRecord[]
  ): Promise<SprintAnalytics> {
    const completedTasks = tasks.filter((t) => t.status === "completed");
    const totalCredits = tasks.reduce((sum, t) => sum + t.creditsUsed, 0);
    const totalEstimated = tasks.reduce(
      (sum, t) => sum + t.estimatedCredits,
      0
    );

    // Calculate agent utilization
    const agentTaskCounts = new Map<string, number>();
    for (const task of tasks) {
      const current = agentTaskCounts.get(task.agentRole) ?? 0;
      agentTaskCounts.set(task.agentRole, current + 1);
    }

    const agentUtilization: Record<string, number> = {};
    const totalTaskCount = tasks.length;
    if (totalTaskCount > 0) {
      for (const [role, count] of agentTaskCounts) {
        agentUtilization[role] = (count / totalTaskCount) * 100;
      }
    }

    // Calculate estimation accuracy
    let accuracy = 0;
    if (totalEstimated > 0) {
      accuracy =
        Math.min(totalEstimated / totalCredits, totalCredits / totalEstimated) *
        100;
    }

    // Fetch team patterns for this sprint period
    let topPatterns: TeamPattern[] = [];
    try {
      topPatterns = await this.analyzeTeamPatterns(orgId);
      topPatterns = topPatterns.slice(0, 5);
    } catch {
      logger.warn(
        { sprintId },
        "Could not fetch patterns for sprint analytics"
      );
    }

    return {
      sprintId,
      totalTasks: tasks.length,
      completedTasks: completedTasks.length,
      totalCreditsUsed: totalCredits,
      avgCostPerTask:
        completedTasks.length > 0 ? totalCredits / completedTasks.length : 0,
      agentUtilization,
      estimatedVsActual: {
        estimated: totalEstimated,
        actual: totalCredits,
        accuracy,
      },
      topPatterns,
    };
  }
}
