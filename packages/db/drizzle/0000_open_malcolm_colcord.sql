CREATE TYPE "public"."agent_aggressiveness" AS ENUM('balanced', 'full_auto', 'supervised');--> statement-breakpoint
CREATE TYPE "public"."agent_mode" AS ENUM('task', 'ask', 'plan', 'watch', 'fleet');--> statement-breakpoint
CREATE TYPE "public"."agent_status" AS ENUM('idle', 'working', 'error', 'terminated');--> statement-breakpoint
CREATE TYPE "public"."architecture_metric_type" AS ENUM('complexity', 'coupling', 'cohesion', 'depth');--> statement-breakpoint
CREATE TYPE "public"."blueprint_enforcement" AS ENUM('strict', 'flexible', 'advisory');--> statement-breakpoint
CREATE TYPE "public"."component_type" AS ENUM('page', 'api_route', 'db_table', 'component', 'service', 'middleware', 'hook', 'utility', 'test');--> statement-breakpoint
CREATE TYPE "public"."correction_type" AS ENUM('code', 'approach', 'style');--> statement-breakpoint
CREATE TYPE "public"."credit_reservation_status" AS ENUM('active', 'committed', 'released');--> statement-breakpoint
CREATE TYPE "public"."credit_transaction_type" AS ENUM('purchase', 'consumption', 'refund', 'bonus', 'subscription_grant');--> statement-breakpoint
CREATE TYPE "public"."deploy_target" AS ENUM('staging', 'production', 'manual');--> statement-breakpoint
CREATE TYPE "public"."deployment_provider" AS ENUM('vercel', 'netlify', 'cloudflare', 'docker');--> statement-breakpoint
CREATE TYPE "public"."deployment_status" AS ENUM('queued', 'building', 'deploying', 'live', 'failed', 'deleted');--> statement-breakpoint
CREATE TYPE "public"."experiment_status" AS ENUM('running', 'completed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."integration_status" AS ENUM('connected', 'disconnected', 'error');--> statement-breakpoint
CREATE TYPE "public"."memory_type" AS ENUM('semantic', 'episodic', 'procedural', 'architectural', 'convention');--> statement-breakpoint
CREATE TYPE "public"."message_role" AS ENUM('user', 'assistant', 'system');--> statement-breakpoint
CREATE TYPE "public"."org_role" AS ENUM('owner', 'admin', 'member');--> statement-breakpoint
CREATE TYPE "public"."plan_tier" AS ENUM('hobby', 'starter', 'pro', 'team', 'studio', 'enterprise');--> statement-breakpoint
CREATE TYPE "public"."project_role" AS ENUM('owner', 'contributor', 'viewer');--> statement-breakpoint
CREATE TYPE "public"."project_status" AS ENUM('active', 'archived', 'setup');--> statement-breakpoint
CREATE TYPE "public"."review_severity" AS ENUM('info', 'warning', 'error', 'critical');--> statement-breakpoint
CREATE TYPE "public"."review_status" AS ENUM('pending', 'in_progress', 'completed');--> statement-breakpoint
CREATE TYPE "public"."security_scan_level" AS ENUM('basic', 'standard', 'thorough');--> statement-breakpoint
CREATE TYPE "public"."session_event_type" AS ENUM('agent_output', 'file_change', 'plan_update', 'task_status', 'queue_position', 'credit_update', 'checkpoint', 'error', 'reasoning', 'terminal_output', 'browser_screenshot', 'pr_created');--> statement-breakpoint
CREATE TYPE "public"."session_status" AS ENUM('active', 'paused', 'completed', 'failed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."subscription_status" AS ENUM('active', 'past_due', 'cancelled', 'trialing', 'incomplete');--> statement-breakpoint
CREATE TYPE "public"."task_status" AS ENUM('pending', 'queued', 'running', 'paused', 'completed', 'failed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."theme" AS ENUM('light', 'dark', 'system');--> statement-breakpoint
CREATE TABLE "agents" (
	"id" text PRIMARY KEY NOT NULL,
	"session_id" text NOT NULL,
	"role" text NOT NULL,
	"status" "agent_status" DEFAULT 'idle' NOT NULL,
	"model_used" text,
	"tokens_in" integer DEFAULT 0 NOT NULL,
	"tokens_out" integer DEFAULT 0 NOT NULL,
	"steps_completed" integer DEFAULT 0 NOT NULL,
	"current_task_id" text,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_active_at" timestamp with time zone DEFAULT now() NOT NULL,
	"terminated_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "api_keys" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"user_id" text NOT NULL,
	"key_hash" text NOT NULL,
	"name" text NOT NULL,
	"scopes" jsonb DEFAULT '[]'::jsonb,
	"last_used" timestamp with time zone,
	"expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone,
	CONSTRAINT "api_keys_key_hash_unique" UNIQUE("key_hash")
);
--> statement-breakpoint
CREATE TABLE "architecture_metrics" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"snapshot_id" text NOT NULL,
	"metric_type" "architecture_metric_type" NOT NULL,
	"value" real NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "architecture_snapshots" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"graph_data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"node_count" integer DEFAULT 0 NOT NULL,
	"edge_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_logs" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"user_id" text,
	"action" text NOT NULL,
	"resource" text NOT NULL,
	"resource_id" text,
	"details" jsonb DEFAULT '{}'::jsonb,
	"ip_address" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "blueprint_components" (
	"id" text PRIMARY KEY NOT NULL,
	"blueprint_id" text NOT NULL,
	"component_type" "component_type" NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"file_path" text,
	"dependencies" jsonb DEFAULT '[]'::jsonb,
	"metadata" jsonb DEFAULT '{}'::jsonb,
	"order" integer DEFAULT 0,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "blueprint_versions" (
	"id" text PRIMARY KEY NOT NULL,
	"blueprint_id" text NOT NULL,
	"version" text NOT NULL,
	"diff" text NOT NULL,
	"changed_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "blueprints" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"version" text NOT NULL,
	"content" text NOT NULL,
	"tech_stack" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tech_stack_presets" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"description" text,
	"config_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"icon" text,
	CONSTRAINT "tech_stack_presets_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "code_reviews" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"session_id" text NOT NULL,
	"status" "review_status" DEFAULT 'pending' NOT NULL,
	"review_type" text NOT NULL,
	"files_reviewed" integer DEFAULT 0 NOT NULL,
	"overall_score" real,
	"summary" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "review_comments" (
	"id" text PRIMARY KEY NOT NULL,
	"review_id" text NOT NULL,
	"file_path" text NOT NULL,
	"line_start" integer NOT NULL,
	"line_end" integer,
	"severity" "review_severity" NOT NULL,
	"category" text NOT NULL,
	"comment" text NOT NULL,
	"suggested_fix" text,
	"resolved" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "project_conventions" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"category" text NOT NULL,
	"pattern" text NOT NULL,
	"description" text NOT NULL,
	"confidence" real DEFAULT 0.5 NOT NULL,
	"file_count" integer DEFAULT 0 NOT NULL,
	"examples" jsonb DEFAULT '[]'::jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "credit_balances" (
	"org_id" text PRIMARY KEY NOT NULL,
	"balance" integer DEFAULT 0 NOT NULL,
	"reserved" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "credit_reservations" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"task_id" text NOT NULL,
	"amount" integer NOT NULL,
	"status" "credit_reservation_status" DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "credit_transactions" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"type" "credit_transaction_type" NOT NULL,
	"amount" integer NOT NULL,
	"balance_before" integer,
	"balance_after" integer NOT NULL,
	"task_id" text,
	"user_id" text,
	"trigger_source" text,
	"stripe_id" text,
	"description" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "processed_webhook_events" (
	"event_id" text PRIMARY KEY NOT NULL,
	"event_type" text NOT NULL,
	"processed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "decision_logs" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"session_id" text,
	"agent_role" text NOT NULL,
	"decision" text NOT NULL,
	"reasoning" text,
	"outcome" text,
	"confidence" real,
	"files_changed" jsonb DEFAULT '[]'::jsonb,
	"credits_consumed" integer DEFAULT 0,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "deployments" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"session_id" text,
	"org_id" text NOT NULL,
	"provider" "deployment_provider" NOT NULL,
	"status" "deployment_status" DEFAULT 'queued' NOT NULL,
	"url" text,
	"branch" text,
	"build_logs" text,
	"error_message" text,
	"provider_deployment_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "domain_rules" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"name" text NOT NULL,
	"description" text NOT NULL,
	"condition" text NOT NULL,
	"severity" text DEFAULT 'warning' NOT NULL,
	"category" text DEFAULT 'business' NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "code_embeddings" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"file_path" text NOT NULL,
	"chunk_index" integer DEFAULT 0 NOT NULL,
	"content" text NOT NULL,
	"embedding" vector(768),
	"embedding_1024" vector(1024),
	"embedding_256" vector(256),
	"symbol_type" text,
	"symbol_name" text,
	"start_line" integer,
	"end_line" integer,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "file_indexes" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"file_path" text NOT NULL,
	"file_hash" text NOT NULL,
	"language" text,
	"loc" integer,
	"last_indexed" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "governance_events" (
	"id" text PRIMARY KEY NOT NULL,
	"session_id" text,
	"org_id" text NOT NULL,
	"project_id" text,
	"event_type" text NOT NULL,
	"agent_role" text NOT NULL,
	"details" jsonb,
	"severity" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "graph_edges" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"source_id" text NOT NULL,
	"target_id" text NOT NULL,
	"edge_type" text NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb,
	"weight" real DEFAULT 1,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "graph_nodes" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"node_type" text NOT NULL,
	"name" text NOT NULL,
	"file_path" text NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb,
	"start_line" integer,
	"end_line" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "installed_plugins" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"plugin_id" text NOT NULL,
	"name" text NOT NULL,
	"version" text NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"config" jsonb DEFAULT '{}'::jsonb,
	"permissions" jsonb DEFAULT '[]'::jsonb,
	"installed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mcp_connections" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"provider" text NOT NULL,
	"credentials_encrypted" text,
	"status" "integration_status" DEFAULT 'disconnected' NOT NULL,
	"connected_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "mcp_tool_configs" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"tool_name" text NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"config_json" jsonb DEFAULT '{}'::jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "webhook_deliveries" (
	"id" text PRIMARY KEY NOT NULL,
	"subscription_id" text NOT NULL,
	"event" text NOT NULL,
	"payload" jsonb NOT NULL,
	"status_code" text,
	"response_body" text,
	"delivered_at" timestamp with time zone DEFAULT now() NOT NULL,
	"success" boolean DEFAULT false NOT NULL,
	"attempt" text DEFAULT '1' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "webhook_subscriptions" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"url" text NOT NULL,
	"secret" text NOT NULL,
	"events" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"description" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_delivered_at" timestamp with time zone,
	"failure_count" text DEFAULT '0' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agent_performance_metrics" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"agent_role" text NOT NULL,
	"metric_type" text NOT NULL,
	"value" real NOT NULL,
	"period" text NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "strategy_experiments" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"experiment_name" text NOT NULL,
	"strategy_a" text NOT NULL,
	"strategy_b" text NOT NULL,
	"results_a" jsonb DEFAULT '{}'::jsonb,
	"results_b" jsonb DEFAULT '{}'::jsonb,
	"winner" text,
	"status" "experiment_status" DEFAULT 'running' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "user_corrections" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"user_id" text NOT NULL,
	"session_id" text NOT NULL,
	"correction_type" "correction_type" NOT NULL,
	"original" text NOT NULL,
	"corrected" text NOT NULL,
	"context" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agent_memories" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"memory_type" "memory_type" NOT NULL,
	"content" text NOT NULL,
	"embedding" vector(768),
	"embedding_1024" vector(1024),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "episodic_memories" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"event_type" text NOT NULL,
	"decision" text NOT NULL,
	"reasoning" text,
	"outcome" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "procedural_memories" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"procedure_name" text NOT NULL,
	"steps" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"last_used" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "model_usage_logs" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"session_id" text,
	"model_key" text NOT NULL,
	"provider" text NOT NULL,
	"slot" text NOT NULL,
	"prompt_tokens" integer DEFAULT 0 NOT NULL,
	"completion_tokens" integer DEFAULT 0 NOT NULL,
	"total_tokens" integer DEFAULT 0 NOT NULL,
	"cost_usd" real DEFAULT 0 NOT NULL,
	"duration_ms" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "model_configs" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"provider" text NOT NULL,
	"model_id" text NOT NULL,
	"api_key_encrypted" text,
	"is_default" boolean DEFAULT false NOT NULL,
	"priority" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "model_usage" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"session_id" text,
	"task_id" text,
	"provider" text NOT NULL,
	"model" text NOT NULL,
	"tokens_in" integer NOT NULL,
	"tokens_out" integer NOT NULL,
	"cost_usd" real NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "org_members" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"user_id" text NOT NULL,
	"role" "org_role" DEFAULT 'member' NOT NULL,
	"invited_at" timestamp with time zone DEFAULT now() NOT NULL,
	"joined_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "organizations" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"plan_tier" "plan_tier" DEFAULT 'hobby' NOT NULL,
	"stripe_customer_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "organizations_slug_unique" UNIQUE("slug"),
	CONSTRAINT "organizations_stripe_customer_id_unique" UNIQUE("stripe_customer_id")
);
--> statement-breakpoint
CREATE TABLE "project_configs" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"model_preferences" jsonb DEFAULT '{}'::jsonb,
	"isolation_level" text DEFAULT 'standard' NOT NULL,
	"rate_limits" jsonb DEFAULT '{}'::jsonb,
	"plugin_allowlist" jsonb DEFAULT '[]'::jsonb,
	"agent_behavior" jsonb DEFAULT '{}'::jsonb,
	"custom_conventions" jsonb DEFAULT '{}'::jsonb,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "project_configs_project_id_unique" UNIQUE("project_id")
);
--> statement-breakpoint
CREATE TABLE "project_members" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"user_id" text NOT NULL,
	"role" "project_role" DEFAULT 'contributor' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "project_settings" (
	"project_id" text PRIMARY KEY NOT NULL,
	"agent_aggressiveness" "agent_aggressiveness" DEFAULT 'balanced' NOT NULL,
	"ci_loop_max_iterations" integer DEFAULT 20 NOT NULL,
	"parallel_agent_count" integer DEFAULT 1 NOT NULL,
	"blueprint_enforcement" "blueprint_enforcement" DEFAULT 'strict' NOT NULL,
	"test_coverage_target" integer DEFAULT 80 NOT NULL,
	"security_scan_level" "security_scan_level" DEFAULT 'standard' NOT NULL,
	"deploy_target" "deploy_target" DEFAULT 'manual' NOT NULL,
	"model_cost_budget" real
);
--> statement-breakpoint
CREATE TABLE "projects" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"repo_url" text,
	"tech_stack_preset" text,
	"status" "project_status" DEFAULT 'setup' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "quality_reviews" (
	"id" text PRIMARY KEY NOT NULL,
	"task_id" text NOT NULL,
	"session_id" text NOT NULL,
	"org_id" text NOT NULL,
	"overall_score" real NOT NULL,
	"correctness_score" real NOT NULL,
	"style_score" real NOT NULL,
	"security_score" real NOT NULL,
	"performance_score" real NOT NULL,
	"reasoning" text NOT NULL,
	"verdict" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "session_events" (
	"id" text PRIMARY KEY NOT NULL,
	"session_id" text NOT NULL,
	"type" "session_event_type" NOT NULL,
	"data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"agent_role" text,
	"timestamp" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "session_messages" (
	"id" text PRIMARY KEY NOT NULL,
	"session_id" text NOT NULL,
	"role" "message_role" NOT NULL,
	"content" text NOT NULL,
	"model_used" text,
	"tokens_in" integer,
	"tokens_out" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"user_id" text NOT NULL,
	"status" "session_status" DEFAULT 'active' NOT NULL,
	"mode" "agent_mode" DEFAULT 'task' NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ended_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "sprint_plans" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"session_id" text,
	"name" text NOT NULL,
	"goals" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "sprint_tasks" (
	"id" text PRIMARY KEY NOT NULL,
	"sprint_id" text NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"agent_role" text NOT NULL,
	"dependencies" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"effort" text DEFAULT 'medium' NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "subscription_plans" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"stripe_price_id" text,
	"credits_included" integer NOT NULL,
	"max_parallel_agents" integer NOT NULL,
	"features_json" jsonb DEFAULT '{}'::jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "subscriptions" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"plan_id" text NOT NULL,
	"stripe_subscription_id" text,
	"status" "subscription_status" DEFAULT 'active' NOT NULL,
	"current_period_start" timestamp with time zone,
	"current_period_end" timestamp with time zone,
	CONSTRAINT "subscriptions_stripe_subscription_id_unique" UNIQUE("stripe_subscription_id")
);
--> statement-breakpoint
CREATE TABLE "task_steps" (
	"id" text PRIMARY KEY NOT NULL,
	"task_id" text NOT NULL,
	"step_number" integer NOT NULL,
	"description" text NOT NULL,
	"status" "task_status" DEFAULT 'pending' NOT NULL,
	"output" text
);
--> statement-breakpoint
CREATE TABLE "tasks" (
	"id" text PRIMARY KEY NOT NULL,
	"session_id" text NOT NULL,
	"project_id" text NOT NULL,
	"org_id" text NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"status" "task_status" DEFAULT 'pending' NOT NULL,
	"priority" integer DEFAULT 50 NOT NULL,
	"agent_role" text,
	"credits_reserved" integer DEFAULT 0 NOT NULL,
	"credits_consumed" integer DEFAULT 0 NOT NULL,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "usage_rollups" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"period_start" timestamp with time zone NOT NULL,
	"period_end" timestamp with time zone NOT NULL,
	"tasks_completed" integer DEFAULT 0 NOT NULL,
	"credits_used" integer DEFAULT 0 NOT NULL,
	"cost_usd" real DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_settings" (
	"user_id" text PRIMARY KEY NOT NULL,
	"theme" "theme" DEFAULT 'system' NOT NULL,
	"default_model" text,
	"notifications_enabled" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" text PRIMARY KEY NOT NULL,
	"clerk_id" text NOT NULL,
	"email" text NOT NULL,
	"name" text,
	"avatar_url" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "users_clerk_id_unique" UNIQUE("clerk_id"),
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "workflow_checkpoints" (
	"id" text PRIMARY KEY NOT NULL,
	"session_id" text NOT NULL,
	"task_id" text NOT NULL,
	"org_id" text NOT NULL,
	"phase" text NOT NULL,
	"iteration" text,
	"state" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workflow_events" (
	"id" text PRIMARY KEY NOT NULL,
	"session_id" text NOT NULL,
	"workflow_id" text NOT NULL,
	"step_name" text NOT NULL,
	"event_type" text NOT NULL,
	"data" jsonb DEFAULT '{}'::jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workspaces" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"is_default" boolean DEFAULT false NOT NULL,
	"settings" jsonb DEFAULT '{}'::jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "agents" ADD CONSTRAINT "agents_session_id_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "architecture_metrics" ADD CONSTRAINT "architecture_metrics_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "architecture_metrics" ADD CONSTRAINT "architecture_metrics_snapshot_id_architecture_snapshots_id_fk" FOREIGN KEY ("snapshot_id") REFERENCES "public"."architecture_snapshots"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "architecture_snapshots" ADD CONSTRAINT "architecture_snapshots_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "blueprint_components" ADD CONSTRAINT "blueprint_components_blueprint_id_blueprints_id_fk" FOREIGN KEY ("blueprint_id") REFERENCES "public"."blueprints"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "blueprint_versions" ADD CONSTRAINT "blueprint_versions_blueprint_id_blueprints_id_fk" FOREIGN KEY ("blueprint_id") REFERENCES "public"."blueprints"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "blueprints" ADD CONSTRAINT "blueprints_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "code_reviews" ADD CONSTRAINT "code_reviews_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "code_reviews" ADD CONSTRAINT "code_reviews_session_id_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_comments" ADD CONSTRAINT "review_comments_review_id_code_reviews_id_fk" FOREIGN KEY ("review_id") REFERENCES "public"."code_reviews"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_conventions" ADD CONSTRAINT "project_conventions_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_balances" ADD CONSTRAINT "credit_balances_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_reservations" ADD CONSTRAINT "credit_reservations_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_transactions" ADD CONSTRAINT "credit_transactions_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "decision_logs" ADD CONSTRAINT "decision_logs_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "decision_logs" ADD CONSTRAINT "decision_logs_session_id_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deployments" ADD CONSTRAINT "deployments_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deployments" ADD CONSTRAINT "deployments_session_id_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deployments" ADD CONSTRAINT "deployments_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "domain_rules" ADD CONSTRAINT "domain_rules_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "code_embeddings" ADD CONSTRAINT "code_embeddings_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "file_indexes" ADD CONSTRAINT "file_indexes_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "graph_edges" ADD CONSTRAINT "graph_edges_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "graph_edges" ADD CONSTRAINT "graph_edges_source_id_graph_nodes_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."graph_nodes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "graph_edges" ADD CONSTRAINT "graph_edges_target_id_graph_nodes_id_fk" FOREIGN KEY ("target_id") REFERENCES "public"."graph_nodes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "graph_nodes" ADD CONSTRAINT "graph_nodes_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "installed_plugins" ADD CONSTRAINT "installed_plugins_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mcp_connections" ADD CONSTRAINT "mcp_connections_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mcp_tool_configs" ADD CONSTRAINT "mcp_tool_configs_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "webhook_deliveries" ADD CONSTRAINT "webhook_deliveries_subscription_id_webhook_subscriptions_id_fk" FOREIGN KEY ("subscription_id") REFERENCES "public"."webhook_subscriptions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "webhook_subscriptions" ADD CONSTRAINT "webhook_subscriptions_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_performance_metrics" ADD CONSTRAINT "agent_performance_metrics_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "strategy_experiments" ADD CONSTRAINT "strategy_experiments_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_corrections" ADD CONSTRAINT "user_corrections_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_corrections" ADD CONSTRAINT "user_corrections_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_corrections" ADD CONSTRAINT "user_corrections_session_id_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_memories" ADD CONSTRAINT "agent_memories_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "episodic_memories" ADD CONSTRAINT "episodic_memories_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "procedural_memories" ADD CONSTRAINT "procedural_memories_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "model_usage_logs" ADD CONSTRAINT "model_usage_logs_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "model_configs" ADD CONSTRAINT "model_configs_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "model_usage" ADD CONSTRAINT "model_usage_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "org_members" ADD CONSTRAINT "org_members_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_configs" ADD CONSTRAINT "project_configs_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_members" ADD CONSTRAINT "project_members_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_settings" ADD CONSTRAINT "project_settings_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quality_reviews" ADD CONSTRAINT "quality_reviews_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quality_reviews" ADD CONSTRAINT "quality_reviews_session_id_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quality_reviews" ADD CONSTRAINT "quality_reviews_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session_events" ADD CONSTRAINT "session_events_session_id_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session_messages" ADD CONSTRAINT "session_messages_session_id_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sprint_plans" ADD CONSTRAINT "sprint_plans_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sprint_plans" ADD CONSTRAINT "sprint_plans_session_id_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sprint_tasks" ADD CONSTRAINT "sprint_tasks_sprint_id_sprint_plans_id_fk" FOREIGN KEY ("sprint_id") REFERENCES "public"."sprint_plans"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_plan_id_subscription_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."subscription_plans"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_steps" ADD CONSTRAINT "task_steps_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_session_id_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "usage_rollups" ADD CONSTRAINT "usage_rollups_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_settings" ADD CONSTRAINT "user_settings_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_checkpoints" ADD CONSTRAINT "workflow_checkpoints_session_id_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_events" ADD CONSTRAINT "workflow_events_session_id_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspaces" ADD CONSTRAINT "workspaces_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "agents_session_id_idx" ON "agents" USING btree ("session_id");--> statement-breakpoint
CREATE INDEX "agents_session_status_idx" ON "agents" USING btree ("session_id","status");--> statement-breakpoint
CREATE INDEX "api_keys_org_id_idx" ON "api_keys" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "api_keys_user_id_idx" ON "api_keys" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "architecture_metrics_project_id_idx" ON "architecture_metrics" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "architecture_metrics_snapshot_id_idx" ON "architecture_metrics" USING btree ("snapshot_id");--> statement-breakpoint
CREATE INDEX "architecture_metrics_type_idx" ON "architecture_metrics" USING btree ("project_id","metric_type");--> statement-breakpoint
CREATE INDEX "architecture_snapshots_project_id_idx" ON "architecture_snapshots" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "architecture_snapshots_created_idx" ON "architecture_snapshots" USING btree ("project_id","created_at");--> statement-breakpoint
CREATE INDEX "audit_logs_org_id_idx" ON "audit_logs" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "audit_logs_org_action_idx" ON "audit_logs" USING btree ("org_id","action");--> statement-breakpoint
CREATE INDEX "audit_logs_created_at_idx" ON "audit_logs" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "blueprint_components_blueprint_id_idx" ON "blueprint_components" USING btree ("blueprint_id");--> statement-breakpoint
CREATE INDEX "blueprint_components_type_idx" ON "blueprint_components" USING btree ("blueprint_id","component_type");--> statement-breakpoint
CREATE INDEX "blueprint_versions_blueprint_id_idx" ON "blueprint_versions" USING btree ("blueprint_id");--> statement-breakpoint
CREATE INDEX "blueprints_project_id_idx" ON "blueprints" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "blueprints_project_active_idx" ON "blueprints" USING btree ("project_id","is_active");--> statement-breakpoint
CREATE INDEX "code_reviews_project_id_idx" ON "code_reviews" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "code_reviews_session_id_idx" ON "code_reviews" USING btree ("session_id");--> statement-breakpoint
CREATE INDEX "code_reviews_status_idx" ON "code_reviews" USING btree ("project_id","status");--> statement-breakpoint
CREATE INDEX "review_comments_review_id_idx" ON "review_comments" USING btree ("review_id");--> statement-breakpoint
CREATE INDEX "review_comments_file_idx" ON "review_comments" USING btree ("review_id","file_path");--> statement-breakpoint
CREATE INDEX "review_comments_severity_idx" ON "review_comments" USING btree ("review_id","severity");--> statement-breakpoint
CREATE INDEX "project_conventions_project_idx" ON "project_conventions" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "project_conventions_project_category_idx" ON "project_conventions" USING btree ("project_id","category");--> statement-breakpoint
CREATE INDEX "credit_reservations_org_id_idx" ON "credit_reservations" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "credit_reservations_org_status_idx" ON "credit_reservations" USING btree ("org_id","status");--> statement-breakpoint
CREATE INDEX "credit_reservations_task_id_idx" ON "credit_reservations" USING btree ("task_id");--> statement-breakpoint
CREATE INDEX "credit_transactions_org_id_idx" ON "credit_transactions" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "credit_transactions_org_type_idx" ON "credit_transactions" USING btree ("org_id","type");--> statement-breakpoint
CREATE INDEX "credit_transactions_task_id_idx" ON "credit_transactions" USING btree ("task_id");--> statement-breakpoint
CREATE INDEX "credit_transactions_org_created_idx" ON "credit_transactions" USING btree ("org_id","created_at");--> statement-breakpoint
CREATE INDEX "credit_transactions_stripe_id_idx" ON "credit_transactions" USING btree ("stripe_id");--> statement-breakpoint
CREATE INDEX "processed_webhook_events_expires_idx" ON "processed_webhook_events" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "decision_logs_project_id_idx" ON "decision_logs" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "decision_logs_session_id_idx" ON "decision_logs" USING btree ("session_id");--> statement-breakpoint
CREATE INDEX "decision_logs_project_role_idx" ON "decision_logs" USING btree ("project_id","agent_role");--> statement-breakpoint
CREATE INDEX "deployments_project_id_idx" ON "deployments" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "deployments_org_id_idx" ON "deployments" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "deployments_status_idx" ON "deployments" USING btree ("status");--> statement-breakpoint
CREATE INDEX "domain_rules_project_id_idx" ON "domain_rules" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "domain_rules_project_category_idx" ON "domain_rules" USING btree ("project_id","category");--> statement-breakpoint
CREATE INDEX "code_embeddings_project_file_idx" ON "code_embeddings" USING btree ("project_id","file_path");--> statement-breakpoint
CREATE INDEX "code_embeddings_embedding_idx" ON "code_embeddings" USING hnsw ("embedding" vector_cosine_ops);--> statement-breakpoint
CREATE INDEX "code_embeddings_embedding_1024_idx" ON "code_embeddings" USING hnsw ("embedding_1024" vector_cosine_ops);--> statement-breakpoint
CREATE INDEX "code_embeddings_embedding_256_idx" ON "code_embeddings" USING hnsw ("embedding_256" vector_cosine_ops);--> statement-breakpoint
CREATE INDEX "code_embeddings_symbol_idx" ON "code_embeddings" USING btree ("project_id","symbol_type","symbol_name");--> statement-breakpoint
CREATE INDEX "file_indexes_project_path_idx" ON "file_indexes" USING btree ("project_id","file_path");--> statement-breakpoint
CREATE INDEX "governance_events_org_id_idx" ON "governance_events" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "governance_events_session_id_idx" ON "governance_events" USING btree ("session_id");--> statement-breakpoint
CREATE INDEX "governance_events_event_type_idx" ON "governance_events" USING btree ("event_type");--> statement-breakpoint
CREATE INDEX "governance_events_severity_idx" ON "governance_events" USING btree ("severity");--> statement-breakpoint
CREATE INDEX "governance_events_created_at_idx" ON "governance_events" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "graph_edges_project_source_idx" ON "graph_edges" USING btree ("project_id","source_id");--> statement-breakpoint
CREATE INDEX "graph_edges_project_target_idx" ON "graph_edges" USING btree ("project_id","target_id");--> statement-breakpoint
CREATE INDEX "graph_edges_source_type_idx" ON "graph_edges" USING btree ("source_id","edge_type");--> statement-breakpoint
CREATE INDEX "graph_nodes_project_path_idx" ON "graph_nodes" USING btree ("project_id","file_path");--> statement-breakpoint
CREATE INDEX "graph_nodes_project_type_idx" ON "graph_nodes" USING btree ("project_id","node_type");--> statement-breakpoint
CREATE INDEX "graph_nodes_project_name_idx" ON "graph_nodes" USING btree ("project_id","name");--> statement-breakpoint
CREATE INDEX "installed_plugins_org_id_idx" ON "installed_plugins" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "installed_plugins_org_plugin_idx" ON "installed_plugins" USING btree ("org_id","plugin_id");--> statement-breakpoint
CREATE INDEX "mcp_connections_org_id_idx" ON "mcp_connections" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "mcp_connections_org_provider_idx" ON "mcp_connections" USING btree ("org_id","provider");--> statement-breakpoint
CREATE INDEX "mcp_tool_configs_project_id_idx" ON "mcp_tool_configs" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "webhook_deliveries_sub_id_idx" ON "webhook_deliveries" USING btree ("subscription_id");--> statement-breakpoint
CREATE INDEX "webhook_deliveries_event_idx" ON "webhook_deliveries" USING btree ("subscription_id","event");--> statement-breakpoint
CREATE INDEX "webhook_subscriptions_org_id_idx" ON "webhook_subscriptions" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "webhook_subscriptions_org_enabled_idx" ON "webhook_subscriptions" USING btree ("org_id","enabled");--> statement-breakpoint
CREATE INDEX "agent_perf_metrics_org_id_idx" ON "agent_performance_metrics" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "agent_perf_metrics_role_idx" ON "agent_performance_metrics" USING btree ("org_id","agent_role");--> statement-breakpoint
CREATE INDEX "agent_perf_metrics_type_idx" ON "agent_performance_metrics" USING btree ("org_id","agent_role","metric_type");--> statement-breakpoint
CREATE INDEX "strategy_experiments_org_id_idx" ON "strategy_experiments" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "strategy_experiments_status_idx" ON "strategy_experiments" USING btree ("org_id","status");--> statement-breakpoint
CREATE INDEX "user_corrections_org_id_idx" ON "user_corrections" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "user_corrections_user_id_idx" ON "user_corrections" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "user_corrections_session_id_idx" ON "user_corrections" USING btree ("session_id");--> statement-breakpoint
CREATE INDEX "user_corrections_type_idx" ON "user_corrections" USING btree ("org_id","correction_type");--> statement-breakpoint
CREATE INDEX "agent_memories_project_id_idx" ON "agent_memories" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "agent_memories_project_type_idx" ON "agent_memories" USING btree ("project_id","memory_type");--> statement-breakpoint
CREATE INDEX "agent_memories_embedding_idx" ON "agent_memories" USING hnsw ("embedding" vector_cosine_ops);--> statement-breakpoint
CREATE INDEX "agent_memories_embedding_1024_idx" ON "agent_memories" USING hnsw ("embedding_1024" vector_cosine_ops);--> statement-breakpoint
CREATE INDEX "episodic_memories_project_id_idx" ON "episodic_memories" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "procedural_memories_project_id_idx" ON "procedural_memories" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "model_usage_logs_org_id_idx" ON "model_usage_logs" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "model_usage_logs_model_key_idx" ON "model_usage_logs" USING btree ("model_key");--> statement-breakpoint
CREATE INDEX "model_usage_logs_created_at_idx" ON "model_usage_logs" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "model_usage_logs_org_created_idx" ON "model_usage_logs" USING btree ("org_id","created_at");--> statement-breakpoint
CREATE INDEX "model_configs_org_id_idx" ON "model_configs" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "model_configs_org_provider_idx" ON "model_configs" USING btree ("org_id","provider");--> statement-breakpoint
CREATE INDEX "model_usage_org_id_idx" ON "model_usage" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "model_usage_session_id_idx" ON "model_usage" USING btree ("session_id");--> statement-breakpoint
CREATE INDEX "model_usage_task_id_idx" ON "model_usage" USING btree ("task_id");--> statement-breakpoint
CREATE INDEX "model_usage_org_model_idx" ON "model_usage" USING btree ("org_id","model");--> statement-breakpoint
CREATE INDEX "org_members_org_id_idx" ON "org_members" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "org_members_user_id_idx" ON "org_members" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "org_members_org_user_idx" ON "org_members" USING btree ("org_id","user_id");--> statement-breakpoint
CREATE INDEX "project_configs_project_id_idx" ON "project_configs" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "project_members_project_id_idx" ON "project_members" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "project_members_user_id_idx" ON "project_members" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "projects_org_id_status_idx" ON "projects" USING btree ("org_id","status");--> statement-breakpoint
CREATE INDEX "projects_org_id_idx" ON "projects" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "quality_reviews_task_idx" ON "quality_reviews" USING btree ("task_id");--> statement-breakpoint
CREATE INDEX "quality_reviews_session_idx" ON "quality_reviews" USING btree ("session_id");--> statement-breakpoint
CREATE INDEX "quality_reviews_org_idx" ON "quality_reviews" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "quality_reviews_verdict_idx" ON "quality_reviews" USING btree ("org_id","verdict");--> statement-breakpoint
CREATE INDEX "session_events_session_id_idx" ON "session_events" USING btree ("session_id");--> statement-breakpoint
CREATE INDEX "session_events_session_type_idx" ON "session_events" USING btree ("session_id","type");--> statement-breakpoint
CREATE INDEX "session_messages_session_id_idx" ON "session_messages" USING btree ("session_id");--> statement-breakpoint
CREATE INDEX "sessions_project_id_idx" ON "sessions" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "sessions_user_id_idx" ON "sessions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "sessions_project_status_idx" ON "sessions" USING btree ("project_id","status");--> statement-breakpoint
CREATE INDEX "sessions_project_created_idx" ON "sessions" USING btree ("project_id","started_at");--> statement-breakpoint
CREATE INDEX "sprint_plans_project_id_idx" ON "sprint_plans" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "sprint_tasks_sprint_id_idx" ON "sprint_tasks" USING btree ("sprint_id");--> statement-breakpoint
CREATE INDEX "subscriptions_org_id_idx" ON "subscriptions" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "subscriptions_org_status_idx" ON "subscriptions" USING btree ("org_id","status");--> statement-breakpoint
CREATE INDEX "task_steps_task_id_idx" ON "task_steps" USING btree ("task_id");--> statement-breakpoint
CREATE INDEX "tasks_session_id_idx" ON "tasks" USING btree ("session_id");--> statement-breakpoint
CREATE INDEX "tasks_project_id_idx" ON "tasks" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "tasks_org_id_status_idx" ON "tasks" USING btree ("org_id","status");--> statement-breakpoint
CREATE INDEX "tasks_project_status_idx" ON "tasks" USING btree ("project_id","status");--> statement-breakpoint
CREATE INDEX "tasks_session_status_idx" ON "tasks" USING btree ("session_id","status");--> statement-breakpoint
CREATE INDEX "usage_rollups_org_id_idx" ON "usage_rollups" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "usage_rollups_org_period_idx" ON "usage_rollups" USING btree ("org_id","period_start");--> statement-breakpoint
CREATE INDEX "workflow_checkpoints_session_id_idx" ON "workflow_checkpoints" USING btree ("session_id");--> statement-breakpoint
CREATE INDEX "workflow_checkpoints_session_task_idx" ON "workflow_checkpoints" USING btree ("session_id","task_id");--> statement-breakpoint
CREATE INDEX "workflow_checkpoints_org_id_idx" ON "workflow_checkpoints" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "workflow_events_session_id_idx" ON "workflow_events" USING btree ("session_id");--> statement-breakpoint
CREATE INDEX "workflow_events_workflow_id_idx" ON "workflow_events" USING btree ("workflow_id");--> statement-breakpoint
CREATE INDEX "workflow_events_created_at_idx" ON "workflow_events" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "workspaces_org_id_idx" ON "workspaces" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "workspaces_org_name_idx" ON "workspaces" USING btree ("org_id","name");