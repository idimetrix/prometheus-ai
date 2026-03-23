import { createInsertSchema, createSelectSchema } from "drizzle-zod";
import { mcpConnections, mcpToolConfigs } from "./integrations";

export const insertMcpConnectionSchema = createInsertSchema(mcpConnections);
export const selectMcpConnectionSchema = createSelectSchema(mcpConnections);
export type McpConnection = typeof mcpConnections.$inferSelect;
export type NewMcpConnection = typeof mcpConnections.$inferInsert;

export const insertMcpToolConfigSchema = createInsertSchema(mcpToolConfigs);
export const selectMcpToolConfigSchema = createSelectSchema(mcpToolConfigs);
export type McpToolConfig = typeof mcpToolConfigs.$inferSelect;
export type NewMcpToolConfig = typeof mcpToolConfigs.$inferInsert;
