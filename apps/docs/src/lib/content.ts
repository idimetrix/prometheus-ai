import fs from "node:fs";
import path from "node:path";
import matter from "gray-matter";

const CONTENT_DIR = path.join(process.cwd(), "content");

const MD_EXTENSION_RE = /\.md$/;

export interface DocPage {
  content: string;
  description: string;
  order: number;
  slug: string;
  title: string;
}

/**
 * Recursively collect all .md files from the content directory.
 * Files in subdirectories get slugs like "agents/orchestrator".
 */
function collectMarkdownFiles(
  dir: string,
  prefix = ""
): Array<{ slug: string; filePath: string }> {
  if (!fs.existsSync(dir)) {
    return [];
  }

  const results: Array<{ slug: string; filePath: string }> = [];

  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      const subPrefix = prefix ? `${prefix}/${entry.name}` : entry.name;
      results.push(
        ...collectMarkdownFiles(path.join(dir, entry.name), subPrefix)
      );
    } else if (entry.name.endsWith(".md")) {
      const slug = prefix
        ? `${prefix}/${entry.name.replace(MD_EXTENSION_RE, "")}`
        : entry.name.replace(MD_EXTENSION_RE, "");
      results.push({ slug, filePath: path.join(dir, entry.name) });
    }
  }

  return results;
}

export function getDocSlugs(): string[] {
  return collectMarkdownFiles(CONTENT_DIR).map((f) => f.slug);
}

export function getDocBySlug(slug: string): DocPage | null {
  // Try direct path first (handles both top-level and nested slugs)
  const filePath = path.join(CONTENT_DIR, `${slug}.md`);
  if (!fs.existsSync(filePath)) {
    return null;
  }

  const raw = fs.readFileSync(filePath, "utf-8");
  const { data, content } = matter(raw);

  return {
    slug,
    title: (data.title as string) ?? slug,
    description: (data.description as string) ?? "",
    order: (data.order as number) ?? 999,
    content,
  };
}

export function getAllDocs(): DocPage[] {
  return getDocSlugs()
    .map(getDocBySlug)
    .filter((d): d is DocPage => d !== null)
    .sort((a, b) => a.order - b.order);
}
