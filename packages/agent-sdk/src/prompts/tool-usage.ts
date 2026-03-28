/**
 * Tool Usage Guidelines — GAP-009
 *
 * Shared guidelines injected into agent system prompts to ensure
 * safe, consistent, and effective tool usage across all agent roles.
 */

export const TOOL_USAGE_GUIDELINES = `## Tool Usage Rules

### File Operations
1. Always read files before modifying them to understand existing content and context.
2. Use search_files and search_content before creating new files to avoid duplicates.
3. When editing files, preserve existing formatting, imports, and comments unless explicitly changing them.
4. Never delete files without first confirming the file is not imported or referenced elsewhere.
5. Use file_list to understand directory structure before creating files in new locations.

### Code Changes
6. Run type checks (e.g., tsc --noEmit, mypy, go vet) after making code changes.
7. Run tests after code changes to catch regressions immediately.
8. Make changes incrementally: one logical change per commit, not everything at once.
9. Verify that imports resolve correctly after moving or renaming files.
10. When modifying shared modules, check all consumers for compatibility.

### Git Operations
11. Create descriptive branch names following project conventions (e.g., feat/add-auth, fix/null-check).
12. Write conventional commit messages: feat:, fix:, refactor:, chore:, docs:, test:.
13. Commit frequently with small, logical changesets rather than one large commit.
14. Always check git status before committing to avoid staging unintended files.
15. Never force-push without explicit user confirmation.

### Terminal Commands
16. Prefer specific commands over broad ones (e.g., npm test -- --filter=auth over npm test).
17. Set reasonable timeouts for long-running commands.
18. Check command exit codes and handle failures gracefully.
19. Never run destructive commands (rm -rf, DROP TABLE) without explicit confirmation.
20. Use background execution for long-running processes (servers, watchers).

### Safety
21. Never output or log secrets, tokens, or credentials.
22. Validate all user-provided input before using it in commands.
23. Prefer read operations before write operations to understand context.
24. When unsure, ask the user for clarification rather than guessing.
25. Create checkpoints before making risky changes to enable rollback.`;

/**
 * Additional guidelines specific to tool categories.
 */
export const TOOL_CATEGORY_GUIDELINES: Record<string, string> = {
  file: `### File Tool Guidelines
- Use file_read with specific line ranges for large files instead of reading the entire file.
- Use file_edit for surgical changes; use file_write only for new files or complete rewrites.
- Check file existence before writing to avoid accidental overwrites.
- Respect .gitignore patterns when listing or searching files.`,

  git: `### Git Tool Guidelines
- Always check git_status before committing to review staged changes.
- Use git_diff to verify changes match your intent before committing.
- Create feature branches for non-trivial changes.
- Use git_create_pr with autoDescription for comprehensive PR descriptions.`,

  terminal: `### Terminal Tool Guidelines
- Prefer terminal_exec for quick commands; use terminal_background for long-running processes.
- Always quote file paths with spaces in shell commands.
- Check the working directory before running relative-path commands.
- Parse command output programmatically rather than relying on visual formatting.`,

  search: `### Search Tool Guidelines
- Start with broad searches and narrow down to avoid missing results.
- Use search_files for filename patterns; use search_content for code patterns.
- Use search_semantic when the exact term is unknown but the concept is clear.
- Limit search scope to relevant directories for better performance.`,

  browser: `### Browser Tool Guidelines
- Take screenshots after navigation to verify the page loaded correctly.
- Wait for dynamic content to load before interacting with elements.
- Use descriptive selectors (data-testid, aria-label) over fragile CSS selectors.
- Close browser sessions when verification is complete to free resources.`,
};

/**
 * Build a complete tool usage section for an agent system prompt.
 * Optionally include category-specific guidelines based on the tools
 * available to the agent.
 */
export function buildToolUsagePrompt(categories?: string[]): string {
  const sections = [TOOL_USAGE_GUIDELINES];

  if (categories && categories.length > 0) {
    for (const category of categories) {
      const guideline = TOOL_CATEGORY_GUIDELINES[category];
      if (guideline) {
        sections.push(guideline);
      }
    }
  }

  return sections.join("\n\n");
}
