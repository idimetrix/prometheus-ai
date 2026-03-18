import Link from "next/link";
import { getAllDocs } from "@/lib/content";

export default function DocsHome() {
  const docs = getAllDocs();

  return (
    <div>
      <h1 className="mb-4 font-bold text-3xl text-zinc-100">Documentation</h1>
      <p className="mb-8 text-lg text-zinc-400">
        Learn how to use the Prometheus AI Engineering Platform to build,
        deploy, and manage your projects.
      </p>

      <div className="space-y-4">
        {docs.map((doc) => (
          <Link
            className="block rounded-xl border border-zinc-800 bg-zinc-900/50 p-5 transition-colors hover:border-violet-500/30 hover:bg-violet-500/5"
            href={`/docs/${doc.slug}`}
            key={doc.slug}
          >
            <h2 className="font-semibold text-lg text-zinc-200">{doc.title}</h2>
            {doc.description && (
              <p className="mt-1 text-sm text-zinc-500">{doc.description}</p>
            )}
          </Link>
        ))}

        {docs.length === 0 && (
          <p className="text-sm text-zinc-600">
            No documentation pages found. Add .md files to the content/
            directory.
          </p>
        )}
      </div>
    </div>
  );
}
