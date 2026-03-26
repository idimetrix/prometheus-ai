import { createLogger } from "@prometheus/logger";
import { generateId } from "@prometheus/utils";

const logger = createLogger("orchestrator:task-decomposer");

/** Regex to extract a JSON array from model output */
const JSON_ARRAY_RE = /\[[\s\S]*\]/;

export interface SubTask {
  agentRole: string;
  dependencies: string[];
  description: string;
  id: string;
  priority: number;
  title: string;
}

/** Phase ordering for dependency graph construction */
const PHASE_ORDER: Record<string, number> = {
  architect: 0,
  planner: 0,
  frontend_coder: 1,
  backend_coder: 1,
  integration_coder: 2,
  test_engineer: 3,
  ci_loop: 3,
  security_auditor: 4,
  deploy_engineer: 5,
  documentation_specialist: 5,
};

const DECOMPOSITION_PROMPT = `You are a task decomposition engine for a multi-agent engineering platform.
Given a task, break it down into sub-tasks and assign each to one of these agent roles:
- architect: system design, schemas, API contracts
- planner: sprint planning, dependency mapping
- frontend_coder: React/Next.js UI implementation
- backend_coder: APIs, services, database logic
- integration_coder: frontend-backend wiring, data flow
- test_engineer: unit, integration, E2E tests
- ci_loop: automated test-fix cycles
- security_auditor: OWASP scans, vulnerability detection
- deploy_engineer: Docker, k8s, CI/CD pipelines
- documentation_specialist: docs, API references, guides

Respond ONLY with a JSON array of objects with these fields:
- title: short task title
- description: what needs to be done
- agentRole: one of the roles above

Example response:
[{"title":"Design API schema","description":"Define REST endpoints and DB schema for the feature","agentRole":"architect"},{"title":"Implement backend API","description":"Build tRPC routes and Drizzle queries","agentRole":"backend_coder"}]
`;

interface ModelRouterResponse {
  choices?: Array<{ message?: { content?: string } }>;
  content?: string;
  text?: string;
}

async function callModelRouter(
  modelRouterUrl: string,
  prompt: string
): Promise<string> {
  const response = await fetch(`${modelRouterUrl}/v1/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "default",
      messages: [
        { role: "system", content: DECOMPOSITION_PROMPT },
        { role: "user", content: prompt },
      ],
      temperature: 0.3,
    }),
  });

  if (!response.ok) {
    throw new Error(
      `Model router returned ${response.status}: ${await response.text()}`
    );
  }

  const data = (await response.json()) as ModelRouterResponse;
  const content =
    data.choices?.[0]?.message?.content ?? data.content ?? data.text ?? "";
  return content;
}

function parseSubTasks(
  raw: string
): Array<{ agentRole: string; description: string; title: string }> {
  // Extract JSON array from the response, handling markdown code blocks
  const jsonMatch = raw.match(JSON_ARRAY_RE);
  if (!jsonMatch) {
    throw new Error("No JSON array found in model response");
  }

  const parsed: unknown = JSON.parse(jsonMatch[0]);
  if (!Array.isArray(parsed)) {
    throw new Error("Expected JSON array from model response");
  }

  return parsed.map((item: unknown) => {
    const obj = item as Record<string, unknown>;
    return {
      title: String(obj.title ?? "Untitled"),
      description: String(obj.description ?? ""),
      agentRole: String(obj.agentRole ?? "backend_coder"),
    };
  });
}

function buildDependencyGraph(
  items: Array<{
    agentRole: string;
    description: string;
    id: string;
    title: string;
  }>
): SubTask[] {
  const phaseGroups = new Map<number, string[]>();

  for (const item of items) {
    const phase = PHASE_ORDER[item.agentRole] ?? 1;
    const existing = phaseGroups.get(phase) ?? [];
    existing.push(item.id);
    phaseGroups.set(phase, existing);
  }

  return items.map((item) => {
    const phase = PHASE_ORDER[item.agentRole] ?? 1;
    const dependencies: string[] = [];

    // Depend on all tasks in the previous phase
    if (phase > 0) {
      const prevPhase = phase - 1;
      const prevIds = phaseGroups.get(prevPhase) ?? [];
      dependencies.push(...prevIds);
    }

    return {
      id: item.id,
      title: item.title,
      description: item.description,
      agentRole: item.agentRole,
      dependencies,
      priority: phase,
    };
  });
}

/**
 * Decompose a high-level task into ordered sub-tasks with agent role assignments.
 *
 * Calls the model router to break down the task, then builds a dependency graph
 * where: architect runs first, coders in parallel, then test, then security.
 */
export async function decomposeTask(
  task: { description: string; projectId: string; title: string },
  modelRouterUrl: string
): Promise<SubTask[]> {
  logger.info(
    { projectId: task.projectId, title: task.title },
    "Decomposing task into sub-tasks"
  );

  const prompt = `Project: ${task.projectId}\nTask: ${task.title}\n\nDescription:\n${task.description}`;

  let rawItems: Array<{
    agentRole: string;
    description: string;
    title: string;
  }>;

  try {
    const raw = await callModelRouter(modelRouterUrl, prompt);
    rawItems = parseSubTasks(raw);
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    logger.warn(
      { error: msg },
      "Model router call failed, using default decomposition"
    );

    // Fallback: create a sensible default decomposition
    rawItems = [
      {
        title: `Design architecture for: ${task.title}`,
        description: `Create system design and API contracts for: ${task.description}`,
        agentRole: "architect",
      },
      {
        title: `Implement backend for: ${task.title}`,
        description: `Build API endpoints and database logic for: ${task.description}`,
        agentRole: "backend_coder",
      },
      {
        title: `Implement frontend for: ${task.title}`,
        description: `Build UI components for: ${task.description}`,
        agentRole: "frontend_coder",
      },
      {
        title: `Write tests for: ${task.title}`,
        description: `Create unit and integration tests for: ${task.description}`,
        agentRole: "test_engineer",
      },
      {
        title: `Security review: ${task.title}`,
        description: `Run security audit on: ${task.description}`,
        agentRole: "security_auditor",
      },
    ];
  }

  // Assign IDs
  const itemsWithIds = rawItems.map((item) => ({
    ...item,
    id: generateId("stk"),
  }));

  const subTasks = buildDependencyGraph(itemsWithIds);

  logger.info(
    { count: subTasks.length, projectId: task.projectId },
    "Task decomposed into sub-tasks"
  );

  return subTasks;
}
