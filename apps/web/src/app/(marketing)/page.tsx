import Link from "next/link";

const AGENTS = [
  { name: "Discovery", desc: "Elicits requirements and clarifies intent" },
  { name: "Architect", desc: "Designs system architecture and blueprints" },
  { name: "Frontend", desc: "Builds UI with React, Vue, or any framework" },
  { name: "Backend", desc: "Implements APIs, services, and business logic" },
  { name: "Database", desc: "Designs schemas, migrations, and queries" },
  { name: "DevOps", desc: "Configures Docker, K8s, CI/CD pipelines" },
  { name: "Testing", desc: "Writes and runs comprehensive test suites" },
  { name: "Security", desc: "Audits code for vulnerabilities" },
  { name: "Documentation", desc: "Generates docs, READMEs, and API specs" },
  { name: "CI-Loop", desc: "Auto-fixes failing tests and builds" },
  { name: "Deployment", desc: "Pushes to staging and production" },
  { name: "Orchestrator", desc: "Coordinates all agents and manages plans" },
];

const FEATURES = [
  {
    title: "12 Specialist Agents",
    desc: "Not one generic AI, but dedicated agents for discovery, architecture, frontend, backend, testing, security, and deployment.",
  },
  {
    title: "CI-Loop Architecture",
    desc: "Automatic test-fail-fix cycles with 80%+ auto-resolution rate. Your code is tested before you see it.",
  },
  {
    title: "Persistent Project Brain",
    desc: "6-layer memory system that genuinely knows your project across sessions. No repeated context needed.",
  },
  {
    title: "Real Production Deployment",
    desc: "Docker, Kubernetes, CI/CD -- not just code files. Complete production-ready infrastructure.",
  },
  {
    title: "Multi-Model Intelligence",
    desc: "Routes to the best LLM for each task. Use Anthropic, OpenAI, Google, Groq, or your own local models.",
  },
  {
    title: "Privacy-First",
    desc: "Run entirely on your own infrastructure with local LLM models. Your code never leaves your network.",
  },
];

const STEPS = [
  { step: "01", title: "Describe", desc: "Tell PROMETHEUS what you want to build in plain English." },
  { step: "02", title: "Plan", desc: "The Discovery agent elicits requirements and generates a Blueprint." },
  { step: "03", title: "Build", desc: "12 agents work in parallel to build, test, and secure your project." },
  { step: "04", title: "Deploy", desc: "Production-ready code delivered as a PR with full CI/CD." },
];

export default function HomePage() {
  return (
    <div>
      {/* Hero */}
      <section className="relative overflow-hidden py-32">
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-violet-900/20 via-zinc-950 to-zinc-950" />
        <div className="relative mx-auto max-w-4xl px-6 text-center">
          <div className="inline-flex items-center gap-2 rounded-full border border-violet-800/40 bg-violet-950/30 px-4 py-1.5 text-xs text-violet-400">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-violet-400" />
            12 specialist AI agents, working in parallel
          </div>
          <h1 className="mt-8 text-5xl font-bold tracking-tight text-zinc-100 md:text-6xl lg:text-7xl">
            The AI Engineering
            <br />
            <span className="bg-gradient-to-r from-violet-400 to-purple-400 bg-clip-text text-transparent">
              Platform
            </span>
          </h1>
          <p className="mx-auto mt-6 max-w-2xl text-lg text-zinc-400">
            12 specialist AI agents that build your entire project -- from
            requirements to production deployment -- without you babysitting.
          </p>
          <div className="mt-10 flex justify-center gap-4">
            <Link
              href="/sign-up"
              className="rounded-xl bg-violet-600 px-8 py-3.5 text-sm font-semibold text-white transition-colors hover:bg-violet-700"
            >
              Get Started Free
            </Link>
            <Link
              href="/pricing"
              className="rounded-xl border border-zinc-700 bg-zinc-900 px-8 py-3.5 text-sm font-semibold text-zinc-300 transition-colors hover:bg-zinc-800"
            >
              View Pricing
            </Link>
          </div>
          <p className="mt-4 text-xs text-zinc-600">
            50 credits free. No credit card required.
          </p>
        </div>
      </section>

      {/* How it works */}
      <section className="border-t border-zinc-800 py-24">
        <div className="mx-auto max-w-6xl px-6">
          <h2 className="text-center text-3xl font-bold text-zinc-100">
            How It Works
          </h2>
          <p className="mx-auto mt-3 max-w-xl text-center text-zinc-500">
            From idea to production in four steps.
          </p>
          <div className="mt-16 grid gap-8 md:grid-cols-4">
            {STEPS.map((s) => (
              <div key={s.step} className="text-center">
                <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-violet-600/10 text-lg font-bold text-violet-400">
                  {s.step}
                </div>
                <h3 className="mt-4 text-lg font-semibold text-zinc-200">
                  {s.title}
                </h3>
                <p className="mt-2 text-sm text-zinc-500">{s.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Features */}
      <section className="border-t border-zinc-800 py-24">
        <div className="mx-auto max-w-6xl px-6">
          <h2 className="text-center text-3xl font-bold text-zinc-100">
            Why PROMETHEUS
          </h2>
          <div className="mt-16 grid gap-6 md:grid-cols-2 lg:grid-cols-3">
            {FEATURES.map((feature) => (
              <div
                key={feature.title}
                className="rounded-xl border border-zinc-800 bg-zinc-900/30 p-6 transition-colors hover:border-zinc-700"
              >
                <h3 className="text-base font-semibold text-zinc-200">
                  {feature.title}
                </h3>
                <p className="mt-2 text-sm leading-relaxed text-zinc-500">
                  {feature.desc}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Agent grid */}
      <section className="border-t border-zinc-800 py-24">
        <div className="mx-auto max-w-6xl px-6">
          <h2 className="text-center text-3xl font-bold text-zinc-100">
            12 Specialist Agents
          </h2>
          <p className="mx-auto mt-3 max-w-xl text-center text-zinc-500">
            Each agent is an expert in its domain, working together to build
            production-ready software.
          </p>
          <div className="mt-12 grid gap-3 md:grid-cols-3 lg:grid-cols-4">
            {AGENTS.map((agent) => (
              <div
                key={agent.name}
                className="rounded-xl border border-zinc-800 bg-zinc-900/30 p-4"
              >
                <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-violet-600/10 text-xs font-bold text-violet-400">
                  {agent.name[0]}
                </div>
                <h4 className="mt-3 text-sm font-semibold text-zinc-200">
                  {agent.name}
                </h4>
                <p className="mt-1 text-xs text-zinc-500">{agent.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="border-t border-zinc-800 py-24">
        <div className="mx-auto max-w-2xl px-6 text-center">
          <h2 className="text-3xl font-bold text-zinc-100">
            Ready to build faster?
          </h2>
          <p className="mt-3 text-zinc-500">
            Start with 50 free credits. No credit card required.
          </p>
          <Link
            href="/sign-up"
            className="mt-8 inline-block rounded-xl bg-violet-600 px-8 py-3.5 text-sm font-semibold text-white transition-colors hover:bg-violet-700"
          >
            Get Started Free
          </Link>
        </div>
      </section>
    </div>
  );
}
