/**
 * Mention Resolver
 *
 * Resolves @mentions in chat messages to concrete context that can be
 * injected into the agent conversation.
 *
 * Supported mention types:
 *   @file:<path>   - fetch file contents from sandbox
 *   @folder:<path> - list files in a folder
 *   @docs:<url>    - fetch and parse documentation URL
 *   @web:<query>   - run a web search
 *   @agent:<role>  - direct message to specific agent role
 */

// ── Types ───────────────────────────────────────────────────────

export type MentionType = "file" | "folder" | "docs" | "web" | "agent";

export interface ParsedMention {
  display: string;
  type: MentionType;
  value: string;
}

export interface ResolvedMention {
  content: string;
  isError: boolean;
  mention: ParsedMention;
}

export interface MentionResolverContext {
  /** Base URL of the sandbox manager service */
  sandboxUrl: string;
  /** Session or sandbox ID */
  sessionId: string;
}

interface ContextMessage {
  content: string;
  role: "system" | "user";
}

// ── Mention parsing ─────────────────────────────────────────────

const MENTION_REGEX = /@(file|folder|docs|web|agent):(\S+)/g;

export function parseMentionsFromText(text: string): ParsedMention[] {
  const mentions: ParsedMention[] = [];
  const regex = new RegExp(MENTION_REGEX.source, "g");
  let match = regex.exec(text);

  while (match !== null) {
    const type = match[1] as MentionType;
    const value = match[2] ?? "";
    mentions.push({
      type,
      value,
      display: `@${type}:${value}`,
    });
    match = regex.exec(text);
  }

  return mentions;
}

export function stripMentionsFromText(text: string): string {
  return text.replace(MENTION_REGEX, "").replace(/\s+/g, " ").trim();
}

// ── Individual resolvers ────────────────────────────────────────

async function resolveFileMention(
  path: string,
  ctx: MentionResolverContext
): Promise<ResolvedMention> {
  const mention: ParsedMention = {
    type: "file",
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

async function resolveFolderMention(
  path: string,
  ctx: MentionResolverContext
): Promise<ResolvedMention> {
  const mention: ParsedMention = {
    type: "folder",
    value: path,
    display: `@folder:${path}`,
  };

  try {
    const url = `${ctx.sandboxUrl}/api/sandboxes/${ctx.sessionId}/files?dir=${encodeURIComponent(path)}`;
    const response = await fetch(url, {
      method: "GET",
      headers: { "Content-Type": "application/json" },
      signal: AbortSignal.timeout(10_000),
    });

    if (!response.ok) {
      return {
        mention,
        content: `Error listing folder: ${response.statusText}`,
        isError: true,
      };
    }

    const data = (await response.json()) as {
      files?: Array<{ name: string; path: string; type: string }>;
    };
    const files = data.files ?? [];

    const listing = files
      .map((f) => `  ${f.type === "directory" ? "[dir]" : "[file]"} ${f.path}`)
      .join("\n");

    return {
      mention,
      content: `Folder: ${path}\n${"─".repeat(40)}\n${listing || "(empty directory)"}`,
      isError: false,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return {
      mention,
      content: `Error listing folder "${path}": ${message}`,
      isError: true,
    };
  }
}

async function resolveDocsMention(url: string): Promise<ResolvedMention> {
  const mention: ParsedMention = {
    type: "docs",
    value: url,
    display: `@docs:${url}`,
  };

  try {
    // Ensure valid URL
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

    const html = await response.text();

    // Extract text content from HTML (basic extraction)
    const textContent = extractTextFromHtml(html);

    // Truncate to avoid blowing up context
    const truncated =
      textContent.length > 8000
        ? `${textContent.slice(0, 8000)}\n\n[... truncated, ${textContent.length} total characters]`
        : textContent;

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

async function resolveWebMention(query: string): Promise<ResolvedMention> {
  const mention: ParsedMention = {
    type: "web",
    value: query,
    display: `@web:${query}`,
  };

  try {
    // Use a simple search API approach
    // In production, this would use a real search service
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
      Abstract?: string;
      AbstractText?: string;
      RelatedTopics?: Array<{ Text?: string; FirstURL?: string }>;
    };

    const parts: string[] = [];

    if (data.AbstractText) {
      parts.push(data.AbstractText);
    }

    const topics = data.RelatedTopics ?? [];
    for (const topic of topics.slice(0, 5)) {
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

function resolveAgentMention(role: string): ResolvedMention {
  const mention: ParsedMention = {
    type: "agent",
    value: role,
    display: `@agent:${role}`,
  };

  return {
    mention,
    content: `Message directed to agent: ${role}`,
    isError: false,
  };
}

// ── HTML text extraction ────────────────────────────────────────

function extractTextFromHtml(html: string): string {
  // Remove script and style tags and their content
  let text = html.replace(
    /<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi,
    ""
  );
  text = text.replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, "");

  // Remove HTML tags
  text = text.replace(/<[^>]+>/g, " ");

  // Decode common HTML entities
  text = text
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ");

  // Collapse whitespace
  text = text.replace(/\s+/g, " ").trim();

  return text;
}

// ── Main resolver ───────────────────────────────────────────────

export function resolveMentions(
  mentions: ParsedMention[],
  ctx: MentionResolverContext
): Promise<ResolvedMention[]> {
  const resolvePromises = mentions.map((mention) => {
    switch (mention.type) {
      case "file":
        return resolveFileMention(mention.value, ctx);
      case "folder":
        return resolveFolderMention(mention.value, ctx);
      case "docs":
        return resolveDocsMention(mention.value);
      case "web":
        return resolveWebMention(mention.value);
      case "agent":
        return resolveAgentMention(mention.value);
      default:
        return {
          mention,
          content: `Unknown mention type: ${mention.type}`,
          isError: true,
        };
    }
  });

  return Promise.all(resolvePromises);
}

/**
 * Resolve mentions and convert to context messages suitable for
 * injection into the agent conversation.
 */
export async function resolveMentionsToMessages(
  text: string,
  ctx: MentionResolverContext
): Promise<{
  agentRole: string | undefined;
  cleanedText: string;
  contextMessages: ContextMessage[];
  resolved: ResolvedMention[];
}> {
  const mentions = parseMentionsFromText(text);
  const cleanedText = stripMentionsFromText(text);

  if (mentions.length === 0) {
    return {
      cleanedText: text,
      contextMessages: [],
      resolved: [],
      agentRole: undefined,
    };
  }

  const resolved = await resolveMentions(mentions, ctx);

  // Build context messages from resolved mentions
  const contextMessages: ContextMessage[] = [];
  let agentRole: string | undefined;

  for (const r of resolved) {
    if (r.mention.type === "agent") {
      agentRole = r.mention.value;
      continue;
    }

    if (!r.isError) {
      contextMessages.push({
        role: "system",
        content: `[Context from ${r.mention.display}]\n${r.content}`,
      });
    }
  }

  return {
    cleanedText,
    contextMessages,
    resolved,
    agentRole,
  };
}
