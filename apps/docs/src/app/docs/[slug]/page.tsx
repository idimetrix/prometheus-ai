import Link from "next/link";
import { notFound } from "next/navigation";
import { getDocBySlug, getDocSlugs } from "@/lib/content";

interface PageProps {
  params: Promise<{ slug: string }>;
}

export async function generateStaticParams() {
  return getDocSlugs().map((slug) => ({ slug }));
}

export default async function DocPage({ params }: PageProps) {
  const { slug } = await params;
  const doc = getDocBySlug(slug);

  if (!doc) {
    notFound();
  }

  return (
    <div>
      <Link
        className="mb-6 inline-flex items-center gap-1 text-sm text-zinc-500 hover:text-violet-400"
        href="/"
      >
        <svg
          aria-hidden="true"
          className="h-4 w-4"
          fill="none"
          stroke="currentColor"
          strokeWidth={1.5}
          viewBox="0 0 24 24"
        >
          <path
            d="M10.5 19.5 3 12m0 0 7.5-7.5M3 12h18"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
        Back to docs
      </Link>

      <article>
        <h1 className="mb-2 font-bold text-3xl text-zinc-100">{doc.title}</h1>
        {doc.description && (
          <p className="mb-8 text-lg text-zinc-400">{doc.description}</p>
        )}
        <div className="prose prose-invert prose-zinc max-w-none prose-pre:border prose-pre:border-zinc-800 prose-pre:bg-zinc-900 prose-a:text-violet-400 prose-code:text-violet-300 prose-headings:text-zinc-200 prose-p:text-zinc-400 prose-strong:text-zinc-200">
          {/* Render raw markdown as pre-formatted for now; MDX can be added later */}
          <div
            dangerouslySetInnerHTML={{
              __html: simpleMarkdownToHtml(doc.content),
            }}
          />
        </div>
      </article>
    </div>
  );
}

/** Minimal markdown-to-HTML conversion for headings, paragraphs, code, lists */
function simpleMarkdownToHtml(md: string): string {
  return (
    md
      // Code blocks
      .replace(
        /```(\w*)\n([\s\S]*?)```/g,
        '<pre><code class="language-$1">$2</code></pre>'
      )
      // Inline code
      .replace(/`([^`]+)`/g, "<code>$1</code>")
      // Headers
      .replace(/^#### (.+)$/gm, "<h4>$1</h4>")
      .replace(/^### (.+)$/gm, "<h3>$1</h3>")
      .replace(/^## (.+)$/gm, "<h2>$1</h2>")
      .replace(/^# (.+)$/gm, "<h1>$1</h1>")
      // Bold
      .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
      // Italic
      .replace(/\*(.+?)\*/g, "<em>$1</em>")
      // Links
      .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>')
      // Unordered lists
      .replace(/^- (.+)$/gm, "<li>$1</li>")
      // Ordered lists
      .replace(/^\d+\. (.+)$/gm, "<li>$1</li>")
      // Wrap consecutive <li> in <ul>
      .replace(/((?:<li>.*<\/li>\n?)+)/g, "<ul>$1</ul>")
      // Horizontal rule
      .replace(/^---$/gm, "<hr />")
      // Paragraphs (lines that aren't already wrapped)
      .replace(/^(?!<[hupol]|<li|<hr|<pre|<code)(.+)$/gm, "<p>$1</p>")
      // Double newlines
      .replace(/\n{2,}/g, "\n")
  );
}
