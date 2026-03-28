/**
 * GAP-053: Sprint Planning
 *
 * Create sprints from task descriptions (AI decomposes into subtasks),
 * list sprints, get sprint board, and estimate effort.
 */

import { createLogger } from "@prometheus/logger";
import { generateId } from "@prometheus/utils";
import { z } from "zod";

const SENTENCE_SPLIT_RE = /[.!?\n]+/;
const WORD_SPLIT_RE = /\s+/;

import { protectedProcedure, router } from "../trpc";

const logger = createLogger("api:sprint-planning");

// ---------------------------------------------------------------------------
// In-memory store (production: database-backed)
// ---------------------------------------------------------------------------

type SprintStatus = "planning" | "active" | "completed";
type SubtaskStatus = "todo" | "in-progress" | "done";

interface Subtask {
  description: string;
  estimatedHours?: number;
  id: string;
  status: SubtaskStatus;
  title: string;
}

interface Sprint {
  createdAt: string;
  description: string;
  id: string;
  orgId: string;
  projectId: string;
  status: SprintStatus;
  subtasks: Subtask[];
  title: string;
}

const sprints = new Map<string, Sprint>();

// ---------------------------------------------------------------------------
// AI task decomposition (simplified)
// ---------------------------------------------------------------------------

function decomposeTask(description: string): Subtask[] {
  // In production, this calls an LLM to decompose. Here we use heuristic splitting.
  const sentences = description
    .split(SENTENCE_SPLIT_RE)
    .map((s) => s.trim())
    .filter((s) => s.length > 5);

  if (sentences.length === 0) {
    return [
      {
        id: generateId("st"),
        title: "Implement feature",
        description,
        status: "todo",
      },
    ];
  }

  return sentences.slice(0, 10).map((sentence, i) => ({
    id: generateId("st"),
    title: `Task ${i + 1}: ${sentence.slice(0, 80)}`,
    description: sentence,
    status: "todo" as SubtaskStatus,
  }));
}

function estimateHours(subtask: Subtask): number {
  const words = subtask.description.split(WORD_SPLIT_RE).length;
  // Rough heuristic: more complex descriptions = more effort
  if (words < 10) {
    return 1;
  }
  if (words < 25) {
    return 2;
  }
  if (words < 50) {
    return 4;
  }
  return 8;
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

export const sprintPlanningRouter = router({
  /**
   * Create a sprint from a task description.
   * AI decomposes the description into subtasks.
   */
  create: protectedProcedure
    .input(
      z.object({
        projectId: z.string().min(1),
        title: z.string().min(1).max(200),
        description: z.string().min(1).max(5000),
      })
    )
    .mutation(({ input, ctx }) => {
      const id = generateId("spr");
      const subtasks = decomposeTask(input.description);

      const sprint: Sprint = {
        id,
        orgId: ctx.orgId,
        projectId: input.projectId,
        title: input.title,
        description: input.description,
        status: "planning",
        subtasks,
        createdAt: new Date().toISOString(),
      };

      sprints.set(id, sprint);

      logger.info(
        {
          sprintId: id,
          projectId: input.projectId,
          subtaskCount: subtasks.length,
        },
        "Sprint created with AI decomposition"
      );

      return {
        id: sprint.id,
        title: sprint.title,
        status: sprint.status,
        subtaskCount: sprint.subtasks.length,
        subtasks: sprint.subtasks.map((s) => ({
          id: s.id,
          title: s.title,
          status: s.status,
        })),
        createdAt: sprint.createdAt,
      };
    }),

  /**
   * List sprints for a project.
   */
  list: protectedProcedure
    .input(
      z.object({
        projectId: z.string().min(1),
        limit: z.number().int().min(1).max(50).default(20),
        offset: z.number().int().min(0).default(0),
      })
    )
    .query(({ input, ctx }) => {
      const projectSprints = [...sprints.values()]
        .filter((s) => s.projectId === input.projectId && s.orgId === ctx.orgId)
        .sort(
          (a, b) =>
            new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
        );

      const total = projectSprints.length;
      const items = projectSprints.slice(
        input.offset,
        input.offset + input.limit
      );

      return {
        items: items.map((s) => ({
          id: s.id,
          title: s.title,
          status: s.status,
          subtaskCount: s.subtasks.length,
          createdAt: s.createdAt,
        })),
        total,
      };
    }),

  /**
   * Get sprint board with todo/in-progress/done columns.
   */
  getBoard: protectedProcedure
    .input(z.object({ sprintId: z.string().min(1) }))
    .query(({ input, ctx }) => {
      const sprint = sprints.get(input.sprintId);
      if (!sprint || sprint.orgId !== ctx.orgId) {
        throw new Error("Sprint not found");
      }

      const todo = sprint.subtasks.filter((s) => s.status === "todo");
      const inProgress = sprint.subtasks.filter(
        (s) => s.status === "in-progress"
      );
      const done = sprint.subtasks.filter((s) => s.status === "done");

      return {
        sprintId: sprint.id,
        title: sprint.title,
        status: sprint.status,
        columns: {
          todo: todo.map((s) => ({
            id: s.id,
            title: s.title,
            estimatedHours: s.estimatedHours,
          })),
          inProgress: inProgress.map((s) => ({
            id: s.id,
            title: s.title,
            estimatedHours: s.estimatedHours,
          })),
          done: done.map((s) => ({
            id: s.id,
            title: s.title,
            estimatedHours: s.estimatedHours,
          })),
        },
      };
    }),

  /**
   * AI estimates effort for each subtask in a sprint.
   */
  estimateEffort: protectedProcedure
    .input(z.object({ sprintId: z.string().min(1) }))
    .mutation(({ input, ctx }) => {
      const sprint = sprints.get(input.sprintId);
      if (!sprint || sprint.orgId !== ctx.orgId) {
        throw new Error("Sprint not found");
      }

      let totalHours = 0;
      const estimates = sprint.subtasks.map((subtask) => {
        const hours = estimateHours(subtask);
        subtask.estimatedHours = hours;
        totalHours += hours;
        return {
          id: subtask.id,
          title: subtask.title,
          estimatedHours: hours,
        };
      });

      logger.info(
        { sprintId: sprint.id, totalHours, subtaskCount: estimates.length },
        "Effort estimated for sprint"
      );

      return {
        sprintId: sprint.id,
        estimates,
        totalEstimatedHours: totalHours,
      };
    }),
});
