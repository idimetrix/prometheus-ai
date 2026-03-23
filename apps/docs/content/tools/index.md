---
title: Tools
description: Complete reference for all agent tools
order: 5
---

## Overview

Prometheus agents use tools to interact with code, infrastructure, and external services. Each agent has access to a subset of tools appropriate for its role.

## File Tools

### file_read

Read the contents of a file from the project repository.

**Parameters:**
- `path` (string, required) — Relative path to the file
- `startLine` (number) — First line to read (1-indexed)
- `endLine` (number) — Last line to read

**Example:**
```json
{ "path": "src/index.ts", "startLine": 1, "endLine": 50 }
```

### file_write

Write content to a file, creating it if it does not exist.

**Parameters:**
- `path` (string, required) — Relative path to the file
- `content` (string, required) — File content to write

### file_edit

Apply a targeted edit to a file using search-and-replace.

**Parameters:**
- `path` (string, required) — Relative path to the file
- `oldContent` (string, required) — Exact text to find
- `newContent` (string, required) — Replacement text

### file_delete

Delete a file from the project.

**Parameters:**
- `path` (string, required) — Relative path to the file

### file_list

List files and directories at a given path.

**Parameters:**
- `path` (string) — Directory to list (defaults to root)
- `recursive` (boolean) — Include subdirectories
- `pattern` (string) — Glob pattern to filter results

## Git Tools

### git_status

Show the working tree status (staged, unstaged, untracked files).

### git_diff

Show changes between commits or between the working tree and index.

**Parameters:**
- `ref` (string) — Commit or branch reference to diff against
- `staged` (boolean) — Show only staged changes

### git_commit

Create a git commit with staged changes.

**Parameters:**
- `message` (string, required) — Commit message

### git_branch

Create, list, or switch branches.

**Parameters:**
- `name` (string) — Branch name to create or switch to
- `action` (string) — `create`, `switch`, or `list`

### git_log

Show recent commit history.

**Parameters:**
- `count` (number) — Number of commits to show (default: 10)
- `path` (string) — Filter by file path

## Terminal Tools

### terminal_exec

Execute a shell command in the project sandbox.

**Parameters:**
- `command` (string, required) — Command to execute
- `cwd` (string) — Working directory
- `timeout` (number) — Timeout in milliseconds (default: 30000)

### terminal_background

Run a long-running command in the background.

**Parameters:**
- `command` (string, required) — Command to execute
- `id` (string, required) — Identifier for the background process

### terminal_kill

Stop a background process.

**Parameters:**
- `id` (string, required) — Background process identifier

## Search Tools

### search_text

Search for text patterns across the codebase.

**Parameters:**
- `query` (string, required) — Search query or regex pattern
- `path` (string) — Directory to search in
- `isRegex` (boolean) — Treat query as a regex
- `caseSensitive` (boolean) — Case-sensitive search
- `maxResults` (number) — Maximum number of results (default: 50)

### search_semantic

Search using natural language descriptions powered by embeddings.

**Parameters:**
- `query` (string, required) — Natural language description
- `limit` (number) — Maximum results (default: 10)

### search_symbol

Find symbol definitions (functions, classes, types).

**Parameters:**
- `name` (string, required) — Symbol name to find
- `kind` (string) — Symbol kind: `function`, `class`, `type`, `variable`

## Browser Tools

### browser_navigate

Navigate to a URL in a headless browser.

**Parameters:**
- `url` (string, required) — URL to navigate to

### browser_screenshot

Capture a screenshot of the current page.

**Parameters:**
- `selector` (string) — CSS selector to screenshot a specific element
- `fullPage` (boolean) — Capture the full scrollable page

### browser_click

Click an element on the page.

**Parameters:**
- `selector` (string, required) — CSS selector of the element

### browser_type

Type text into an input element.

**Parameters:**
- `selector` (string, required) — CSS selector of the input
- `text` (string, required) — Text to type

### browser_evaluate

Execute JavaScript in the browser context.

**Parameters:**
- `script` (string, required) — JavaScript code to evaluate

## Sandbox Tools

### sandbox_create

Create an isolated execution environment.

**Parameters:**
- `image` (string) — Container image (default: `node:22-slim`)
- `memory` (string) — Memory limit (default: `512m`)
- `cpu` (string) — CPU limit (default: `1.0`)

### sandbox_exec

Execute a command inside a sandbox.

**Parameters:**
- `sandboxId` (string, required) — Sandbox identifier
- `command` (string, required) — Command to run
- `timeout` (number) — Timeout in milliseconds

### sandbox_destroy

Tear down a sandbox and release resources.

**Parameters:**
- `sandboxId` (string, required) — Sandbox identifier

## Agent Tools

### agent_delegate

Delegate a sub-task to another agent.

**Parameters:**
- `agent` (string, required) — Target agent name
- `task` (string, required) — Task description
- `context` (object) — Additional context to pass

### agent_ask

Ask another agent a question and get a response.

**Parameters:**
- `agent` (string, required) — Target agent name
- `question` (string, required) — Question to ask

### context_get

Retrieve context from the Project Brain.

**Parameters:**
- `query` (string, required) — Context query
- `type` (string) — Context type: `code`, `architecture`, `decision`

### context_store

Store context in the Project Brain for future reference.

**Parameters:**
- `key` (string, required) — Context key
- `value` (string, required) — Context value
- `type` (string) — Context type
