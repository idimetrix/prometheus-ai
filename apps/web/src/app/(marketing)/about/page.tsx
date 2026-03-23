import type { Route } from "next";
import Link from "next/link";

const STATS = [
  { value: "12", label: "Specialist Agents" },
  { value: "28", label: "Packages" },
  { value: "9", label: "Services" },
  { value: "16+", label: "Integrations" },
  { value: "9", label: "Model Providers" },
  { value: "8", label: "Memory Layers" },
];

const TECH_STACK = [
  {
    category: "Frontend",
    items: ["Next.js 15 (App Router)", "React 19", "Tailwind CSS", "shadcn/ui"],
  },
  {
    category: "Backend",
    items: [
      "Hono (API framework)",
      "tRPC (type-safe RPC)",
      "Drizzle ORM",
      "Zod validation",
    ],
  },
  {
    category: "Infrastructure",
    items: ["PostgreSQL", "Redis", "BullMQ (queue)", "MinIO (object storage)"],
  },
  {
    category: "AI / LLM",
    items: [
      "Anthropic Claude",
      "OpenAI GPT-4",
      "Google Gemini",
      "Ollama (local)",
    ],
  },
  {
    category: "DevOps",
    items: ["Docker", "Kubernetes", "Turborepo", "GitHub Actions"],
  },
  {
    category: "Quality",
    items: [
      "Biome (lint + format)",
      "Vitest (testing)",
      "Lefthook (git hooks)",
      "TypeScript strict",
    ],
  },
];

const PRINCIPLES = [
  {
    title: "Agent Specialization Over Generalization",
    desc: "Each of our 12 agents is purpose-built for a specific part of the development lifecycle. A dedicated Testing agent writes better tests than a general-purpose AI, and a Security agent catches vulnerabilities that generalists miss.",
  },
  {
    title: "Memory That Persists",
    desc: "Most AI tools forget everything between sessions. Our 8-layer memory system genuinely knows your project -- architecture, conventions, past decisions, and evolution. No repeated context, no re-explaining.",
  },
  {
    title: "Privacy by Architecture",
    desc: "Self-host the entire platform on your own infrastructure. Run local LLMs with Ollama. Deploy to air-gapped environments. Your code, your data, your network.",
  },
  {
    title: "Open Source Foundation",
    desc: "PROMETHEUS is built on open-source technologies and designed to be extensible. The plugin marketplace, MCP Gateway, and custom model support let you tailor the platform to your exact workflow.",
  },
  {
    title: "CI-Loop Quality Assurance",
    desc: "Every piece of generated code goes through automatic test-fail-fix cycles and security audits before deployment. The CI-Loop agent auto-resolves 80%+ of test failures without human intervention.",
  },
  {
    title: "Multi-Model Intelligence",
    desc: "No single LLM is best at everything. Our model router selects the optimal provider for each task -- Claude for reasoning, GPT-4 for breadth, Groq for speed, local models for privacy.",
  },
];

export default function AboutPage() {
  return (
    <div className="py-24">
      <div className="mx-auto max-w-5xl px-6">
        {/* Mission */}
        <div className="text-center">
          <h1 className="font-bold text-4xl text-zinc-100 tracking-tight md:text-5xl">
            About PROMETHEUS
          </h1>
          <p className="mx-auto mt-6 max-w-3xl text-lg text-zinc-400 leading-relaxed">
            PROMETHEUS is the first AI engineering platform that builds your
            entire project -- from requirements to production deployment --
            using 12 specialist AI agents working in concert. We believe
            software engineering should be a collaboration between humans and
            AI, where each contributes what they do best.
          </p>
        </div>

        {/* Key metrics */}
        <div className="mt-16 rounded-2xl border border-zinc-800 bg-zinc-900/30 p-8">
          <h2 className="text-center font-semibold text-lg text-zinc-200">
            PROMETHEUS by the Numbers
          </h2>
          <div className="mt-8 grid grid-cols-2 gap-6 md:grid-cols-3 lg:grid-cols-6">
            {STATS.map((stat) => (
              <div className="text-center" key={stat.label}>
                <div className="font-bold text-3xl text-violet-400">
                  {stat.value}
                </div>
                <div className="mt-1 text-sm text-zinc-500">{stat.label}</div>
              </div>
            ))}
          </div>
        </div>

        {/* Mission & principles */}
        <div className="mt-20">
          <h2 className="font-bold text-2xl text-zinc-100">
            Our Design Principles
          </h2>
          <p className="mt-2 max-w-2xl text-zinc-500">
            The engineering decisions behind PROMETHEUS.
          </p>
          <div className="mt-8 grid gap-4 md:grid-cols-2">
            {PRINCIPLES.map((p) => (
              <div
                className="rounded-xl border border-zinc-800 bg-zinc-900/30 p-6 transition-colors hover:border-zinc-700"
                key={p.title}
              >
                <h3 className="font-semibold text-base text-zinc-200">
                  {p.title}
                </h3>
                <p className="mt-2 text-sm text-zinc-500 leading-relaxed">
                  {p.desc}
                </p>
              </div>
            ))}
          </div>
        </div>

        {/* Technology stack */}
        <div className="mt-20">
          <h2 className="font-bold text-2xl text-zinc-100">
            Technology Overview
          </h2>
          <p className="mt-2 max-w-2xl text-zinc-500">
            Built with modern, battle-tested open-source technologies.
          </p>
          <div className="mt-8 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {TECH_STACK.map((group) => (
              <div
                className="rounded-xl border border-zinc-800 bg-zinc-900/30 p-5"
                key={group.category}
              >
                <h3 className="font-semibold text-sm text-violet-400 uppercase tracking-wider">
                  {group.category}
                </h3>
                <ul className="mt-3 space-y-2">
                  {group.items.map((item) => (
                    <li
                      className="flex items-center gap-2 text-sm text-zinc-400"
                      key={item}
                    >
                      <div className="h-1.5 w-1.5 rounded-full bg-zinc-600" />
                      {item}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>

        {/* How it works */}
        <div className="mt-20">
          <h2 className="font-bold text-2xl text-zinc-100">How It Works</h2>
          <p className="mt-2 max-w-2xl text-zinc-500">
            From idea to production in three steps.
          </p>
          <div className="mt-8 space-y-3">
            {[
              "Describe what you want to build in natural language",
              "The Discovery agent elicits requirements and generates a Blueprint",
              "The Architect designs the system and assigns tasks to specialist agents",
              "12 agents work in parallel to build, test, and secure your project",
              "The CI-Loop agent automatically fixes failing tests and builds",
              "Security audit runs before every deployment",
              "Production-ready code delivered as a pull request",
            ].map((step, i) => (
              <div
                className="flex items-center gap-3 rounded-lg border border-zinc-800 bg-zinc-900/30 px-4 py-3"
                key={step}
              >
                <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-violet-600/10 font-bold text-violet-400 text-xs">
                  {i + 1}
                </div>
                <span className="text-sm text-zinc-300">{step}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Open source commitment */}
        <div className="mt-20 rounded-2xl border border-zinc-800 bg-zinc-900/30 p-8 text-center">
          <h2 className="font-bold text-2xl text-zinc-100">
            Open Source Commitment
          </h2>
          <p className="mx-auto mt-4 max-w-2xl text-zinc-400 leading-relaxed">
            PROMETHEUS is built on open-source technologies and designed for
            transparency. Our plugin SDK, model routing layer, and deployment
            tooling are open source. We believe the best developer tools are
            built in the open, with community input driving the roadmap.
          </p>
          <div className="mt-6 flex justify-center gap-4">
            <Link
              className="rounded-xl bg-violet-600 px-8 py-3.5 font-semibold text-sm text-white transition-colors hover:bg-violet-700"
              href={"/sign-up" as Route}
            >
              Get Started Free
            </Link>
            <Link
              className="rounded-xl border border-zinc-700 bg-zinc-900 px-8 py-3.5 font-semibold text-sm text-zinc-300 transition-colors hover:bg-zinc-800"
              href="/pricing"
            >
              View Pricing
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
