import { z } from "zod";

export const listTeamQuotasSchema = z.object({
  limit: z.number().int().min(1).max(100).default(50),
  cursor: z.string().optional(),
});

export const setTeamQuotaSchema = z.object({
  userId: z.string().min(1),
  maxConcurrentSessions: z.number().int().min(0).max(50).optional(),
  maxDailyCredits: z.number().int().min(0).max(10_000).optional(),
});

export const getTeamQuotaSchema = z.object({
  userId: z.string().min(1).optional(),
});

export type ListTeamQuotasInput = z.infer<typeof listTeamQuotasSchema>;
export type SetTeamQuotaInput = z.infer<typeof setTeamQuotaSchema>;
export type GetTeamQuotaInput = z.infer<typeof getTeamQuotaSchema>;
