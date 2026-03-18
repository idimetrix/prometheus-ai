import { pgEnum } from "drizzle-orm/pg-core";

// ─── Users ──────────────────────────────────────────────────────────────────
export const themeEnum = pgEnum("theme", ["light", "dark", "system"]);

// ─── Organizations ──────────────────────────────────────────────────────────
export const planTierEnum = pgEnum("plan_tier", [
  "hobby",
  "starter",
  "pro",
  "team",
  "studio",
  "enterprise",
]);

export const orgRoleEnum = pgEnum("org_role", ["owner", "admin", "member"]);

// ─── Projects ───────────────────────────────────────────────────────────────
export const projectStatusEnum = pgEnum("project_status", [
  "active",
  "archived",
  "setup",
]);
export const agentAggressivenessEnum = pgEnum("agent_aggressiveness", [
  "balanced",
  "full_auto",
  "supervised",
]);
export const blueprintEnforcementEnum = pgEnum("blueprint_enforcement", [
  "strict",
  "flexible",
  "advisory",
]);
export const securityScanLevelEnum = pgEnum("security_scan_level", [
  "basic",
  "standard",
  "thorough",
]);
export const deployTargetEnum = pgEnum("deploy_target", [
  "staging",
  "production",
  "manual",
]);
export const projectRoleEnum = pgEnum("project_role", [
  "owner",
  "contributor",
  "viewer",
]);

// ─── Sessions ───────────────────────────────────────────────────────────────
export const sessionStatusEnum = pgEnum("session_status", [
  "active",
  "paused",
  "completed",
  "failed",
  "cancelled",
]);

export const agentModeEnum = pgEnum("agent_mode", [
  "task",
  "ask",
  "plan",
  "watch",
  "fleet",
]);

export const sessionEventTypeEnum = pgEnum("session_event_type", [
  "agent_output",
  "file_change",
  "plan_update",
  "task_status",
  "queue_position",
  "credit_update",
  "checkpoint",
  "error",
  "reasoning",
  "terminal_output",
  "browser_screenshot",
]);

export const messageRoleEnum = pgEnum("message_role", [
  "user",
  "assistant",
  "system",
]);

// ─── Tasks ──────────────────────────────────────────────────────────────────
export const taskStatusEnum = pgEnum("task_status", [
  "pending",
  "queued",
  "running",
  "paused",
  "completed",
  "failed",
  "cancelled",
]);

// ─── Agents ─────────────────────────────────────────────────────────────────
export const agentStatusEnum = pgEnum("agent_status", [
  "idle",
  "working",
  "error",
  "terminated",
]);

// ─── Credits ────────────────────────────────────────────────────────────────
export const creditTransactionTypeEnum = pgEnum("credit_transaction_type", [
  "purchase",
  "consumption",
  "refund",
  "bonus",
  "subscription_grant",
]);

export const creditReservationStatusEnum = pgEnum("credit_reservation_status", [
  "active",
  "committed",
  "released",
]);

// ─── Integrations ───────────────────────────────────────────────────────────
export const integrationStatusEnum = pgEnum("integration_status", [
  "connected",
  "disconnected",
  "error",
]);

// ─── Memories ───────────────────────────────────────────────────────────────
export const memoryTypeEnum = pgEnum("memory_type", [
  "semantic",
  "episodic",
  "procedural",
  "architectural",
  "convention",
]);

// ─── Subscriptions ──────────────────────────────────────────────────────────
export const subscriptionStatusEnum = pgEnum("subscription_status", [
  "active",
  "past_due",
  "cancelled",
  "trialing",
  "incomplete",
]);
