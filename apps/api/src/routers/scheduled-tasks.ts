import { createLogger } from "@prometheus/logger";
import { generateId } from "@prometheus/utils";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { protectedProcedure, router } from "../trpc";

const logger = createLogger("scheduled-tasks-router");

/* -------------------------------------------------------------------------- */
/*  In-memory store                                                           */
/*  Configuration stored in-memory; task execution is handled by BullMQ       */
/*  ScheduledTaskManager.                                                     */
/* -------------------------------------------------------------------------- */

interface ScheduledTaskRecord {
  createdAt: Date;
  createdBy: string;
  cronPattern: string;
  description: string;
  id: string;
  isActive: boolean;
  lastRunAt: Date | null;
  nextRunAt: Date | null;
  orgId: string;
  projectId: string | null;
  timezone: string;
  title: string;
  updatedAt: Date;
}

const scheduledTaskStore = new Map<string, ScheduledTaskRecord>();

const WHITESPACE_RE = /\s+/;

/* -------------------------------------------------------------------------- */
/*  Helpers                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * Compute the next run time from a 5-field cron expression.
 *
 * Parses minute and hour fields to determine the next occurrence. For more
 * complex expressions (day-of-month, month, day-of-week wildcards), a
 * dedicated library such as cron-parser should be used.
 */
function computeNextRun(cronExpression: string, _timezone: string): Date {
  // Parse the 5-field cron expression: minute hour dayOfMonth month dayOfWeek
  const parts = cronExpression.trim().split(WHITESPACE_RE);
  if (parts.length !== 5) {
    return new Date(Date.now() + 3_600_000);
  }

  const now = new Date();
  const [minField, hourField] = parts;

  // Simple next-run computation for common patterns
  const minute =
    minField === "*" ? now.getMinutes() : Number.parseInt(minField ?? "0", 10);
  const hour =
    hourField === "*" ? now.getHours() : Number.parseInt(hourField ?? "0", 10);

  const next = new Date(now);
  next.setMinutes(minute);
  next.setSeconds(0);
  next.setMilliseconds(0);

  if (hourField !== "*") {
    next.setHours(hour);
  }

  // If the computed time is in the past, advance to next occurrence
  if (next <= now) {
    if (hourField === "*") {
      next.setHours(next.getHours() + 1);
    } else {
      next.setDate(next.getDate() + 1);
    }
  }

  return next;
}

/* -------------------------------------------------------------------------- */
/*  Validation Schemas                                                        */
/* -------------------------------------------------------------------------- */

const cronPatternSchema = z
  .string()
  .min(9, "Cron pattern too short")
  .max(100, "Cron pattern too long")
  .regex(
    /^(\S+\s+){4}\S+$/,
    "Must be a valid 5-field cron pattern (minute hour day month weekday)"
  );

const timezoneSchema = z.string().min(1).max(50).default("UTC");

/* -------------------------------------------------------------------------- */
/*  Router                                                                    */
/* -------------------------------------------------------------------------- */

export const scheduledTasksRouter = router({
  /**
   * Create a scheduled task with a cron pattern, timezone, and task description.
   */
  create: protectedProcedure
    .input(
      z.object({
        title: z.string().min(1).max(200),
        description: z.string().min(1).max(10_000),
        cronPattern: cronPatternSchema,
        timezone: timezoneSchema,
        projectId: z.string().optional(),
      })
    )
    .mutation(({ input, ctx }) => {
      const id = generateId();
      const now = new Date();
      const nextRun = computeNextRun(input.cronPattern, input.timezone);

      const task: ScheduledTaskRecord = {
        id,
        title: input.title,
        description: input.description,
        cronPattern: input.cronPattern,
        timezone: input.timezone,
        orgId: ctx.orgId,
        projectId: input.projectId ?? null,
        createdBy: ctx.auth.userId,
        isActive: true,
        lastRunAt: null,
        nextRunAt: nextRun,
        createdAt: now,
        updatedAt: now,
      };

      scheduledTaskStore.set(id, task);

      logger.info(
        {
          id,
          cronPattern: input.cronPattern,
          timezone: input.timezone,
          orgId: ctx.orgId,
        },
        "Scheduled task created"
      );

      return {
        id: task.id,
        title: task.title,
        cronPattern: task.cronPattern,
        timezone: task.timezone,
        isActive: task.isActive,
        nextRunAt: task.nextRunAt?.toISOString() ?? null,
        createdAt: task.createdAt.toISOString(),
      };
    }),

  /**
   * List scheduled tasks for the current org.
   */
  list: protectedProcedure
    .input(
      z
        .object({
          limit: z.number().int().min(1).max(100).default(50),
          offset: z.number().int().min(0).default(0),
          activeOnly: z.boolean().default(false),
        })
        .optional()
        .default({ limit: 50, offset: 0, activeOnly: false })
    )
    .query(({ input, ctx }) => {
      const allTasks: ScheduledTaskRecord[] = [];

      for (const task of scheduledTaskStore.values()) {
        if (task.orgId !== ctx.orgId) {
          continue;
        }
        if (input.activeOnly && !task.isActive) {
          continue;
        }
        allTasks.push(task);
      }

      // Sort by creation date descending
      allTasks.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());

      const items = allTasks
        .slice(input.offset, input.offset + input.limit)
        .map((t) => ({
          id: t.id,
          title: t.title,
          description: t.description,
          cronPattern: t.cronPattern,
          timezone: t.timezone,
          isActive: t.isActive,
          projectId: t.projectId,
          lastRunAt: t.lastRunAt?.toISOString() ?? null,
          nextRunAt: t.nextRunAt?.toISOString() ?? null,
          createdAt: t.createdAt.toISOString(),
          updatedAt: t.updatedAt.toISOString(),
        }));

      return { items, total: allTasks.length };
    }),

  /**
   * Get a specific scheduled task by ID.
   */
  get: protectedProcedure
    .input(z.object({ id: z.string().min(1) }))
    .query(({ input, ctx }) => {
      const task = scheduledTaskStore.get(input.id);

      if (!task || task.orgId !== ctx.orgId) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Scheduled task not found",
        });
      }

      return {
        id: task.id,
        title: task.title,
        description: task.description,
        cronPattern: task.cronPattern,
        timezone: task.timezone,
        isActive: task.isActive,
        projectId: task.projectId,
        createdBy: task.createdBy,
        lastRunAt: task.lastRunAt?.toISOString() ?? null,
        nextRunAt: task.nextRunAt?.toISOString() ?? null,
        createdAt: task.createdAt.toISOString(),
        updatedAt: task.updatedAt.toISOString(),
      };
    }),

  /**
   * Update a scheduled task's schedule or description.
   */
  update: protectedProcedure
    .input(
      z.object({
        id: z.string().min(1),
        title: z.string().min(1).max(200).optional(),
        description: z.string().min(1).max(10_000).optional(),
        cronPattern: cronPatternSchema.optional(),
        timezone: z.string().min(1).max(50).optional(),
        projectId: z.string().nullable().optional(),
      })
    )
    .mutation(({ input, ctx }) => {
      const task = scheduledTaskStore.get(input.id);

      if (!task || task.orgId !== ctx.orgId) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Scheduled task not found",
        });
      }

      if (input.title !== undefined) {
        task.title = input.title;
      }
      if (input.description !== undefined) {
        task.description = input.description;
      }
      if (input.cronPattern !== undefined) {
        task.cronPattern = input.cronPattern;
      }
      if (input.timezone !== undefined) {
        task.timezone = input.timezone;
      }
      if (input.projectId !== undefined) {
        task.projectId = input.projectId;
      }

      // Recompute next run if the schedule changed
      if (input.cronPattern !== undefined || input.timezone !== undefined) {
        task.nextRunAt = task.isActive
          ? computeNextRun(task.cronPattern, task.timezone)
          : null;
      }

      task.updatedAt = new Date();
      scheduledTaskStore.set(input.id, task);

      logger.info({ id: input.id, orgId: ctx.orgId }, "Scheduled task updated");

      return {
        id: task.id,
        title: task.title,
        description: task.description,
        cronPattern: task.cronPattern,
        timezone: task.timezone,
        isActive: task.isActive,
        nextRunAt: task.nextRunAt?.toISOString() ?? null,
        updatedAt: task.updatedAt.toISOString(),
      };
    }),

  /**
   * Delete a scheduled task.
   */
  delete: protectedProcedure
    .input(z.object({ id: z.string().min(1) }))
    .mutation(({ input, ctx }) => {
      const task = scheduledTaskStore.get(input.id);

      if (!task || task.orgId !== ctx.orgId) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Scheduled task not found",
        });
      }

      scheduledTaskStore.delete(input.id);

      logger.info({ id: input.id, orgId: ctx.orgId }, "Scheduled task deleted");

      return { success: true };
    }),

  /**
   * Enable a scheduled task (resume recurring execution).
   */
  enable: protectedProcedure
    .input(z.object({ id: z.string().min(1) }))
    .mutation(({ input, ctx }) => {
      const task = scheduledTaskStore.get(input.id);

      if (!task || task.orgId !== ctx.orgId) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Scheduled task not found",
        });
      }

      if (task.isActive) {
        return {
          id: task.id,
          isActive: task.isActive,
          nextRunAt: task.nextRunAt?.toISOString() ?? null,
        };
      }

      task.isActive = true;
      task.nextRunAt = computeNextRun(task.cronPattern, task.timezone);
      task.updatedAt = new Date();
      scheduledTaskStore.set(input.id, task);

      logger.info({ id: input.id, orgId: ctx.orgId }, "Scheduled task enabled");

      return {
        id: task.id,
        isActive: task.isActive,
        nextRunAt: task.nextRunAt?.toISOString() ?? null,
      };
    }),

  /**
   * Disable a scheduled task (pause recurring execution).
   */
  disable: protectedProcedure
    .input(z.object({ id: z.string().min(1) }))
    .mutation(({ input, ctx }) => {
      const task = scheduledTaskStore.get(input.id);

      if (!task || task.orgId !== ctx.orgId) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Scheduled task not found",
        });
      }

      if (!task.isActive) {
        return {
          id: task.id,
          isActive: task.isActive,
          nextRunAt: null,
        };
      }

      task.isActive = false;
      task.nextRunAt = null;
      task.updatedAt = new Date();
      scheduledTaskStore.set(input.id, task);

      logger.info(
        { id: input.id, orgId: ctx.orgId },
        "Scheduled task disabled"
      );

      return {
        id: task.id,
        isActive: task.isActive,
        nextRunAt: null,
      };
    }),
});
