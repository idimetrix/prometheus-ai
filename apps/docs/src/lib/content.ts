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

export function getDocSlugs(): string[] {
  if (!fs.existsSync(CONTENT_DIR)) {
    return [];
  }
  return fs
    .readdirSync(CONTENT_DIR)
    .filter((f) => f.endsWith(".md"))
    .map((f) => f.replace(MD_EXTENSION_RE, ""));
}

export function getDocBySlug(slug: string): DocPage | null {
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
