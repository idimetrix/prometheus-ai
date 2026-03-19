/**
 * Tool dependency classifier for parallel execution.
 * Determines which tool calls can be executed simultaneously
 * and which must be sequential.
 */

/** Tools that only read state and have no side effects */
const READ_ONLY_TOOLS = new Set([
  "file_read",
  "file_list",
  "search_files",
  "search_content",
  "search_semantic",
  "git_status",
  "git_diff",
  "read_blueprint",
  "read_brain",
  "browser_open",
]);

/** Tools that modify state and may conflict with each other */
const WRITE_TOOLS = new Set(["file_write", "file_edit", "file_delete"]);

/** Tools that must always run sequentially (side effects, order matters) */
const SEQUENTIAL_TOOLS = new Set([
  "terminal_exec",
  "spawn_agent",
  "kill_agent",
  "ask_user",
]);

interface ToolCallInfo {
  args: Record<string, unknown>;
  id: string;
  name: string;
}

export interface ToolExecutionGroup {
  /** Tool calls in this group can execute in parallel */
  calls: ToolCallInfo[];
  /** Whether this group must wait for previous groups to complete */
  sequential: boolean;
}

/**
 * Classify tool calls into execution groups that maximize parallelism
 * while respecting dependencies:
 *
 * - Read-only tools (file_read, search_*) are always independent
 * - Write tools to DIFFERENT files are independent
 * - Write tools to the SAME file must be sequential
 * - terminal_exec is always sequential (commands may depend on prior state)
 * - A write to file X depends on a prior read of file X in the same batch
 *
 * Returns an ordered list of groups. Each group's calls can run in parallel,
 * but groups themselves run sequentially.
 */
export function classifyToolDependencies(
  toolCalls: ToolCallInfo[]
): ToolExecutionGroup[] {
  if (toolCalls.length <= 1) {
    return [{ calls: toolCalls, sequential: false }];
  }

  const groups: ToolExecutionGroup[] = [];
  const parallelReads: ToolCallInfo[] = [];
  const writesByPath = new Map<string, ToolCallInfo[]>();
  const sequentialCalls: ToolCallInfo[] = [];

  for (const tc of toolCalls) {
    if (SEQUENTIAL_TOOLS.has(tc.name)) {
      sequentialCalls.push(tc);
    } else if (READ_ONLY_TOOLS.has(tc.name)) {
      parallelReads.push(tc);
    } else if (WRITE_TOOLS.has(tc.name)) {
      const filePath = getFilePath(tc.args);
      if (filePath) {
        const existing = writesByPath.get(filePath) ?? [];
        existing.push(tc);
        writesByPath.set(filePath, existing);
      } else {
        // No path identified, treat as sequential
        sequentialCalls.push(tc);
      }
    } else {
      // Unknown tools default to parallel (conservative: sequential)
      parallelReads.push(tc);
    }
  }

  // Group 1: All read-only calls can run in parallel
  if (parallelReads.length > 0) {
    groups.push({ calls: parallelReads, sequential: false });
  }

  // Group 2: Write calls — parallel if different files, sequential if same file
  const parallelWrites: ToolCallInfo[] = [];
  for (const [_path, writes] of writesByPath) {
    if (writes.length === 1) {
      parallelWrites.push(writes[0] as ToolCallInfo);
    } else {
      // Multiple writes to same file: first one goes with parallel batch,
      // rest go sequential
      parallelWrites.push(writes[0] as ToolCallInfo);
      for (let i = 1; i < writes.length; i++) {
        sequentialCalls.push(writes[i] as ToolCallInfo);
      }
    }
  }

  if (parallelWrites.length > 0) {
    groups.push({ calls: parallelWrites, sequential: false });
  }

  // Group 3+: Sequential calls, each in their own group
  for (const tc of sequentialCalls) {
    groups.push({ calls: [tc], sequential: true });
  }

  return groups;
}

function getFilePath(args: Record<string, unknown>): string | undefined {
  return (args.path as string) ?? (args.filePath as string) ?? undefined;
}
