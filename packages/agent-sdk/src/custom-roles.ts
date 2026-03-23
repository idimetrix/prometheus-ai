import { createLogger } from "@prometheus/logger";
import type { AgentRole } from "@prometheus/types";
import { type AgentContext, BaseAgent, resolveTools } from "./base-agent";
import type { AgentRoleConfig } from "./roles/index";

const logger = createLogger("agent-sdk:custom-roles");

const SNAKE_CASE_RE = /^[a-z][a-z0-9_]*$/;

// ---------------------------------------------------------------------------
// YAML Agent Spec Types
// ---------------------------------------------------------------------------

/**
 * YAML-based agent specification format. Users can define custom agent roles
 * by writing a YAML file that conforms to this structure.
 *
 * Example YAML:
 * ```yaml
 * role: api_designer
 * displayName: API Designer
 * description: Designs REST and GraphQL API contracts
 * preferredModel: ollama/deepseek-r1:32b
 * tools:
 *   - file_read
 *   - file_write
 *   - search_files
 *   - search_content
 * systemPrompt: |
 *   You are an API Designer agent for PROMETHEUS.
 *   Your job is to design clean, consistent API contracts...
 * constraints:
 *   - Never write implementation code
 *   - Always use OpenAPI 3.1 format
 * capabilities:
 *   - REST API design
 *   - GraphQL schema design
 *   - API versioning strategy
 * ```
 */
export interface CustomAgentSpec {
  /** Optional list of capabilities for discovery */
  capabilities?: string[];
  /** Optional constraints the agent must follow */
  constraints?: string[];
  /** Description of the agent's purpose */
  description: string;
  /** Human-readable display name */
  displayName: string;
  /** Preferred model in "provider/model" format */
  preferredModel: string;
  /** Unique role identifier (snake_case) */
  role: string;
  /** System prompt template. Can use {{sessionId}}, {{projectId}} placeholders */
  systemPrompt: string;
  /** Optional tags for categorization */
  tags?: string[];
  /** List of tool names the agent can use */
  tools: string[];
}

// ---------------------------------------------------------------------------
// YAML Parser (simple key-value + list parser)
// ---------------------------------------------------------------------------

/**
 * Parse a YAML agent spec string into a CustomAgentSpec object.
 * This is a lightweight parser that handles the specific YAML subset
 * used by agent specs (no need for a full YAML library).
 */
interface YamlParserState {
  currentKey: string | null;
  currentList: string[] | null;
  currentMultiline: string[] | null;
  result: Record<string, unknown>;
}

function flushMultiline(state: YamlParserState): void {
  if (state.currentMultiline !== null && state.currentKey !== null) {
    state.result[state.currentKey] = state.currentMultiline
      .join("\n")
      .trimEnd();
    state.currentMultiline = null;
    state.currentKey = null;
  }
}

function flushList(state: YamlParserState): void {
  if (state.currentList !== null && state.currentKey !== null) {
    state.result[state.currentKey] = state.currentList;
    state.currentList = null;
    state.currentKey = null;
  }
}

function handleMultilineContinuation(
  state: YamlParserState,
  line: string
): boolean {
  if (state.currentMultiline === null || state.currentKey === null) {
    return false;
  }
  if (line.startsWith("  ") || line === "") {
    state.currentMultiline.push(line.startsWith("  ") ? line.slice(2) : "");
    return true;
  }
  flushMultiline(state);
  return false;
}

function handleListContinuation(
  state: YamlParserState,
  trimmed: string
): boolean {
  if (state.currentList === null || state.currentKey === null) {
    return false;
  }
  if (trimmed.startsWith("- ")) {
    state.currentList.push(trimmed.slice(2).trim());
    return true;
  }
  if (trimmed === "") {
    return true;
  }
  flushList(state);
  return false;
}

function parseKeyValue(state: YamlParserState, trimmed: string): void {
  const colonIdx = trimmed.indexOf(":");
  if (colonIdx === -1) {
    return;
  }

  const key = trimmed.slice(0, colonIdx).trim();
  const value = trimmed.slice(colonIdx + 1).trim();

  if (value === "|") {
    state.currentKey = key;
    state.currentMultiline = [];
  } else if (value === "") {
    state.currentKey = key;
    state.currentList = [];
  } else {
    state.result[key] = value;
  }
}

export function parseAgentSpec(yamlContent: string): CustomAgentSpec {
  const lines = yamlContent.split("\n");
  const state: YamlParserState = {
    result: {},
    currentKey: null,
    currentMultiline: null,
    currentList: null,
  };

  for (const line of lines) {
    const trimmed = line.trim();

    if (trimmed.startsWith("#")) {
      continue;
    }

    if (handleMultilineContinuation(state, line)) {
      continue;
    }
    if (handleListContinuation(state, trimmed)) {
      continue;
    }
    if (trimmed === "") {
      continue;
    }

    parseKeyValue(state, trimmed);
  }

  flushMultiline(state);
  flushList(state);

  const r = state.result;
  return {
    role: String(r.role ?? ""),
    displayName: String(r.displayName ?? ""),
    description: String(r.description ?? ""),
    preferredModel: String(r.preferredModel ?? "ollama/qwen3-coder-next"),
    tools: Array.isArray(r.tools) ? r.tools : [],
    systemPrompt: String(r.systemPrompt ?? ""),
    constraints: Array.isArray(r.constraints) ? r.constraints : undefined,
    capabilities: Array.isArray(r.capabilities) ? r.capabilities : undefined,
    tags: Array.isArray(r.tags) ? r.tags : undefined,
  };
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

export interface ValidationResult {
  errors: string[];
  valid: boolean;
  warnings: string[];
}

/**
 * Validate a custom agent spec before activation.
 */
export function validateAgentSpec(spec: CustomAgentSpec): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  // Required fields
  if (!spec.role || typeof spec.role !== "string") {
    errors.push("'role' is required and must be a non-empty string");
  } else if (!SNAKE_CASE_RE.test(spec.role)) {
    errors.push(
      "'role' must be snake_case (lowercase letters, numbers, underscores)"
    );
  }

  if (!spec.displayName || typeof spec.displayName !== "string") {
    errors.push("'displayName' is required and must be a non-empty string");
  }

  if (!spec.description || typeof spec.description !== "string") {
    errors.push("'description' is required and must be a non-empty string");
  }

  if (!spec.systemPrompt || typeof spec.systemPrompt !== "string") {
    errors.push("'systemPrompt' is required and must be a non-empty string");
  } else if (spec.systemPrompt.length < 50) {
    warnings.push(
      "'systemPrompt' is very short. Consider adding more detail for better agent performance"
    );
  }

  // Tools validation
  if (!(spec.tools && Array.isArray(spec.tools)) || spec.tools.length === 0) {
    errors.push("'tools' must be a non-empty array of tool names");
  }

  // Model format validation
  if (spec.preferredModel && !spec.preferredModel.includes("/")) {
    warnings.push(
      "'preferredModel' should be in 'provider/model' format (e.g., 'ollama/qwen3-coder-next')"
    );
  }

  // Check for reserved role names
  const reservedRoles = [
    "orchestrator",
    "discovery",
    "architect",
    "planner",
    "frontend_coder",
    "backend_coder",
    "integration_coder",
    "test_engineer",
    "ci_loop",
    "security_auditor",
    "deploy_engineer",
  ];
  if (reservedRoles.includes(spec.role)) {
    errors.push(
      `'${spec.role}' is a built-in role and cannot be used as a custom role name`
    );
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}

// ---------------------------------------------------------------------------
// Custom Agent Class
// ---------------------------------------------------------------------------

/**
 * Dynamic agent class created from a CustomAgentSpec.
 */
class CustomAgent extends BaseAgent {
  private readonly spec: CustomAgentSpec;

  constructor(spec: CustomAgentSpec) {
    const tools = resolveTools(spec.tools);
    super(spec.role as AgentRole, tools);
    this.spec = spec;
  }

  getPreferredModel(): string {
    return this.spec.preferredModel;
  }

  getAllowedTools(): string[] {
    return this.spec.tools;
  }

  getSystemPrompt(context: AgentContext): string {
    let prompt = this.spec.systemPrompt;

    // Replace template placeholders
    prompt = prompt
      .replace(/\{\{sessionId\}\}/g, context.sessionId)
      .replace(/\{\{projectId\}\}/g, context.projectId)
      .replace(/\{\{orgId\}\}/g, context.orgId)
      .replace(/\{\{role\}\}/g, this.spec.role);

    // Append constraints if defined
    if (this.spec.constraints && this.spec.constraints.length > 0) {
      prompt += "\n\n## CONSTRAINTS\n";
      for (const constraint of this.spec.constraints) {
        prompt += `- ${constraint}\n`;
      }
    }

    // Append blueprint context if available
    if (context.blueprintContent) {
      prompt += `\n\n## CURRENT BLUEPRINT\n${context.blueprintContent}`;
    }

    return prompt;
  }
}

// ---------------------------------------------------------------------------
// Custom Role Registry
// ---------------------------------------------------------------------------

/** Store for registered custom agent roles */
const customRoles = new Map<
  string,
  { spec: CustomAgentSpec; config: AgentRoleConfig }
>();

/**
 * Register a custom agent role from a YAML spec string.
 * Parses, validates, and registers the role for use by the orchestrator.
 */
export function registerCustomRole(yamlContent: string): {
  config: AgentRoleConfig;
  validation: ValidationResult;
} {
  const spec = parseAgentSpec(yamlContent);
  const validation = validateAgentSpec(spec);

  if (!validation.valid) {
    throw new Error(`Invalid agent spec: ${validation.errors.join("; ")}`);
  }

  const config: AgentRoleConfig = {
    role: spec.role as AgentRole,
    displayName: spec.displayName,
    description: spec.description,
    preferredModel: spec.preferredModel,
    tools: spec.tools,
    create: () => new CustomAgent(spec),
  };

  customRoles.set(spec.role, { spec, config });

  logger.info(
    {
      role: spec.role,
      displayName: spec.displayName,
      toolCount: spec.tools.length,
    },
    "Custom agent role registered"
  );

  return { config, validation };
}

/**
 * Unregister a custom agent role.
 */
export function unregisterCustomRole(role: string): boolean {
  const existed = customRoles.delete(role);
  if (existed) {
    logger.info({ role }, "Custom agent role unregistered");
  }
  return existed;
}

/**
 * Get a custom agent role config by name.
 */
export function getCustomRole(role: string): AgentRoleConfig | undefined {
  return customRoles.get(role)?.config;
}

/**
 * Get the spec for a custom agent role.
 */
export function getCustomRoleSpec(role: string): CustomAgentSpec | undefined {
  return customRoles.get(role)?.spec;
}

/**
 * List all registered custom agent roles.
 */
export function listCustomRoles(): Array<{
  role: string;
  displayName: string;
  description: string;
  preferredModel: string;
  tools: string[];
  capabilities: string[];
  tags: string[];
}> {
  return Array.from(customRoles.values()).map(({ spec }) => ({
    role: spec.role,
    displayName: spec.displayName,
    description: spec.description,
    preferredModel: spec.preferredModel,
    tools: spec.tools,
    capabilities: spec.capabilities ?? [],
    tags: spec.tags ?? [],
  }));
}
