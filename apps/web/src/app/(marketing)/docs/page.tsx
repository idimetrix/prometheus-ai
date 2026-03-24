import type { Route } from "next";
import Link from "next/link";

const sections = [
  {
    title: "Getting Started",
    items: [
      {
        title: "Quick Start",
        description:
          "Create your first project and run your first task in under 5 minutes.",
      },
      {
        title: "Installation",
        description:
          "Self-host PROMETHEUS on your own infrastructure with Docker or Kubernetes.",
      },
      {
        title: "Configuration",
        description:
          "Configure model providers, integrations, and environment settings.",
      },
    ],
  },
  {
    title: "Core Concepts",
    items: [
      {
        title: "Sessions & Tasks",
        description:
          "Understand how sessions manage agent execution and task lifecycle.",
      },
      {
        title: "12 Specialist Agents",
        description:
          "Learn what each agent does and how they collaborate on your project.",
      },
      {
        title: "Project Brain",
        description:
          "How the 8-layer memory system remembers your project across sessions.",
      },
    ],
  },
  {
    title: "Advanced",
    items: [
      {
        title: "Model Routing",
        description:
          "Configure custom model routing rules and bring your own API keys.",
      },
      {
        title: "Plugins & MCP",
        description:
          "Extend PROMETHEUS with plugins and Model Context Protocol integrations.",
      },
      {
        title: "Fleet Mode",
        description:
          "Run multiple agents in parallel for maximum throughput on large projects.",
      },
    ],
  },
];

export default function DocsPage() {
  return (
    <div className="mx-auto max-w-5xl px-6 py-20">
      <div className="mb-16 text-center">
        <h1 className="mb-4 font-bold text-4xl text-zinc-100 tracking-tight">
          Documentation
        </h1>
        <p className="mx-auto max-w-2xl text-lg text-zinc-400">
          Everything you need to build with PROMETHEUS. From getting started to
          advanced configuration.
        </p>
      </div>

      <div className="mb-12 rounded-xl border border-violet-500/20 bg-violet-500/5 p-6">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-violet-600/20 text-xl">
            &rarr;
          </div>
          <div>
            <h3 className="font-semibold text-zinc-200">API Reference</h3>
            <p className="text-sm text-zinc-400">
              Full tRPC API reference with examples for every endpoint.{" "}
              <Link
                className="text-violet-400 hover:text-violet-300"
                href={"/docs/api" as Route}
              >
                View API docs &rarr;
              </Link>
            </p>
          </div>
        </div>
      </div>

      {sections.map((section) => (
        <div className="mb-12" key={section.title}>
          <h2 className="mb-6 font-semibold text-xl text-zinc-200">
            {section.title}
          </h2>
          <div className="grid gap-4 md:grid-cols-3">
            {section.items.map((item) => (
              <div
                className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-5 transition-colors hover:border-zinc-700"
                key={item.title}
              >
                <h3 className="mb-2 font-medium text-zinc-200">{item.title}</h3>
                <p className="text-sm text-zinc-500">{item.description}</p>
              </div>
            ))}
          </div>
        </div>
      ))}

      <div className="mt-16 text-center">
        <p className="text-sm text-zinc-500">
          Need help?{" "}
          <Link className="text-violet-400 hover:text-violet-300" href="/about">
            Contact our team
          </Link>{" "}
          or check the{" "}
          <Link
            className="text-violet-400 hover:text-violet-300"
            href={"/docs/api" as Route}
          >
            API Reference
          </Link>
          .
        </p>
      </div>
    </div>
  );
}
