/**
 * Mention Types Registry
 *
 * Defines all supported @mention types with their prefixes, descriptions,
 * and resolver functions for the context system.
 */

import type {
  MentionResolverContext,
  ResolvedMention,
} from "./mention-resolver";

// ── Types ───────────────────────────────────────────────────────

export type MentionTypeKey =
  | "file"
  | "codebase"
  | "issue"
  | "pr"
  | "docs"
  | "web";

export interface MentionTypeDefinition {
  description: string;
  prefix: string;
  resolver: (
    query: string,
    ctx: MentionResolverContext
  ) => Promise<ResolvedMention> | ResolvedMention;
}

// ── Individual Resolvers ────────────────────────────────────────

async function resolveFile(
  path: string,
  ctx: MentionResolverContext
): Promise<ResolvedMention> {
  const mention = {
    type: "file" as const,
    value: path,
    display: `@file:${path}`,
  };
  try {
    const url = `${ctx.sandboxUrl}/api/sandboxes/${ctx.sessionId}/files/${encodeURIComponent(path)}`;
    const response = await fetch(url, {
      method: "GET",
      headers: { "Content-Type": "application/json" },
      signal: AbortSignal.timeout(10_000),
    });

    if (!response.ok) {
      return {
        mention,
        content: `Error reading file: ${response.statusText}`,
        isError: true,
      };
    }

    const data = (await response.json()) as { content?: string };
    const content = data.content ?? (await response.text());
    return {
      mention,
      content: `File: ${path}\n${"─".repeat(40)}\n${content}`,
      isError: false,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return {
      mention,
      content: `Error reading file "${path}": ${message}`,
      isError: true,
    };
  }
}

function resolveCodebase(
  query: string,
  _ctx: MentionResolverContext
): ResolvedMention {
  const mention = {
    type: "file" as const,
    value: query,
    display: `@codebase:${query}`,
  };
  // In production, this would trigger a full codebase search via project-brain
  return {
    mention,
    content: `Codebase search for: "${query}"\n${"─".repeat(40)}\nSearch results would appear here from the project-brain semantic search.`,
    isError: false,
  };
}

function resolveIssue(
  issueRef: string,
  _ctx: MentionResolverContext
): ResolvedMention {
  const mention = {
    type: "file" as const,
    value: issueRef,
    display: `@issue:${issueRef}`,
  };
  // In production, this would fetch the issue from the issue-sync provider
  return {
    mention,
    content: `Issue: ${issueRef}\n${"─".repeat(40)}\nIssue details would be fetched from the configured issue tracker (GitHub, Linear, Jira).`,
    isError: false,
  };
}

function resolvePR(
  prRef: string,
  _ctx: MentionResolverContext
): ResolvedMention {
  const mention = {
    type: "file" as const,
    value: prRef,
    display: `@pr:${prRef}`,
  };
  // In production, this would fetch the PR details from the Git provider
  return {
    mention,
    content: `Pull Request: ${prRef}\n${"─".repeat(40)}\nPR details, diff, and review comments would be fetched from the Git provider.`,
    isError: false,
  };
}

async function resolveDocs(
  url: string,
  _ctx: MentionResolverContext
): Promise<ResolvedMention> {
  const mention = {
    type: "docs" as const,
    value: url,
    display: `@docs:${url}`,
  };
  try {
    const parsedUrl = new URL(url.startsWith("http") ? url : `https://${url}`);
    const response = await fetch(parsedUrl.toString(), {
      method: "GET",
      headers: {
        Accept: "text/html, text/plain",
        "User-Agent": "Prometheus-MentionResolver/1.0",
      },
      signal: AbortSignal.timeout(15_000),
    });

    if (!response.ok) {
      return {
        mention,
        content: `Error fetching documentation: ${response.statusText}`,
        isError: true,
      };
    }

    const text = await response.text();
    // Basic HTML stripping
    const stripped = text
      .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, "")
      .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, "")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim();

    const truncated =
      stripped.length > 8000
        ? `${stripped.slice(0, 8000)}\n\n[... truncated, ${stripped.length} total characters]`
        : stripped;

    return {
      mention,
      content: `Documentation from: ${parsedUrl.toString()}\n${"─".repeat(40)}\n${truncated}`,
      isError: false,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return {
      mention,
      content: `Error fetching docs "${url}": ${message}`,
      isError: true,
    };
  }
}

async function resolveWeb(
  query: string,
  _ctx: MentionResolverContext
): Promise<ResolvedMention> {
  const mention = {
    type: "web" as const,
    value: query,
    display: `@web:${query}`,
  };
  try {
    const searchUrl = `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1`;
    const response = await fetch(searchUrl, {
      method: "GET",
      signal: AbortSignal.timeout(10_000),
    });

    if (!response.ok) {
      return {
        mention,
        content: `Web search completed for: "${query}" (no results available via API)`,
        isError: false,
      };
    }

    const data = (await response.json()) as {
      AbstractText?: string;
      RelatedTopics?: Array<{ Text?: string }>;
    };

    const parts: string[] = [];
    if (data.AbstractText) {
      parts.push(data.AbstractText);
    }
    for (const topic of (data.RelatedTopics ?? []).slice(0, 5)) {
      if (topic.Text) {
        parts.push(`- ${topic.Text}`);
      }
    }

    const content =
      parts.length > 0
        ? parts.join("\n\n")
        : `Search results for "${query}" (no structured results available)`;

    return {
      mention,
      content: `Web search: "${query}"\n${"─".repeat(40)}\n${content}`,
      isError: false,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return {
      mention,
      content: `Error searching web for "${query}": ${message}`,
      isError: true,
    };
  }
}

// ── Mention Types Registry ──────────────────────────────────────

export const MENTION_TYPES: Record<MentionTypeKey, MentionTypeDefinition> = {
  file: {
    prefix: "@file:",
    description: "Include file content",
    resolver: resolveFile,
  },
  codebase: {
    prefix: "@codebase",
    description: "Search entire codebase",
    resolver: resolveCodebase,
  },
  issue: {
    prefix: "@issue:",
    description: "Reference an issue",
    resolver: resolveIssue,
  },
  pr: {
    prefix: "@pr:",
    description: "Reference a pull request",
    resolver: resolvePR,
  },
  docs: {
    prefix: "@docs:",
    description: "Search documentation",
    resolver: resolveDocs,
  },
  web: {
    prefix: "@web:",
    description: "Search the web",
    resolver: resolveWeb,
  },
} as const;

/**
 * Resolve a mention by type and query using the registry.
 */
export function resolveMentionByType(
  type: MentionTypeKey,
  query: string,
  ctx: MentionResolverContext
): Promise<ResolvedMention> | ResolvedMention {
  const definition = MENTION_TYPES[type];
  if (!definition) {
    return {
      mention: { type: "file", value: query, display: `@${type}:${query}` },
      content: `Unknown mention type: ${type}`,
      isError: true,
    };
  }
  return definition.resolver(query, ctx);
}

/**
 * Get all available mention types as a list.
 */
export function listMentionTypes(): Array<{
  description: string;
  key: MentionTypeKey;
  prefix: string;
}> {
  return Object.entries(MENTION_TYPES).map(([key, def]) => ({
    key: key as MentionTypeKey,
    prefix: def.prefix,
    description: def.description,
  }));
}
