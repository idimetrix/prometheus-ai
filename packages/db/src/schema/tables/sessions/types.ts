import { createInsertSchema, createSelectSchema } from "drizzle-zod";
import { sessionCheckpoints } from "./session-checkpoints";
import { sessionEvents, sessionMessages, sessions } from "./sessions";

export const insertSessionSchema = createInsertSchema(sessions);
export const selectSessionSchema = createSelectSchema(sessions);
export type Session = typeof sessions.$inferSelect;
export type NewSession = typeof sessions.$inferInsert;

export const insertSessionEventSchema = createInsertSchema(sessionEvents);
export const selectSessionEventSchema = createSelectSchema(sessionEvents);
export type SessionEvent = typeof sessionEvents.$inferSelect;
export type NewSessionEvent = typeof sessionEvents.$inferInsert;

export const insertSessionMessageSchema = createInsertSchema(sessionMessages);
export const selectSessionMessageSchema = createSelectSchema(sessionMessages);
export type SessionMessage = typeof sessionMessages.$inferSelect;
export type NewSessionMessage = typeof sessionMessages.$inferInsert;

export const insertSessionCheckpointSchema =
  createInsertSchema(sessionCheckpoints);
export const selectSessionCheckpointSchema =
  createSelectSchema(sessionCheckpoints);
export type SessionCheckpoint = typeof sessionCheckpoints.$inferSelect;
export type NewSessionCheckpoint = typeof sessionCheckpoints.$inferInsert;
