import type { Route } from "next";
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
    icon: (
      <svg
        aria-hidden="true"
        className="h-6 w-6 text-violet-400"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.5}
        viewBox="0 0 24 24"
      >
        <path
          d="M8.25 3v1.5M4.5 8.25H3m18 0h-1.5M4.5 12H3m18 0h-1.5m-15 3.75H3m18 0h-1.5M8.25 19.5V21M12 3v1.5m0 15V21m3.75-18v1.5m0 15V21m-9-1.5h10.5a2.25 2.25 0 0 0 2.25-2.25V6.75a2.25 2.25 0 0 0-2.25-2.25H6.75A2.25 2.25 0 0 0 4.5 6.75v10.5a2.25 2.25 0 0 0 2.25 2.25Z"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    ),
  },
  {
    title: "Free Model Routing",
    desc: "Routes to the best LLM for each task. Use Anthropic, OpenAI, Google, Groq, or bring your own local models -- all included.",
    icon: (
      <svg
        aria-hidden="true"
        className="h-6 w-6 text-blue-400"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.5}
        viewBox="0 0 24 24"
      >
        <path
          d="M7.5 21 3 16.5m0 0L7.5 12M3 16.5h13.5m0-13.5L21 7.5m0 0L16.5 12M21 7.5H7.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    ),
  },
  {
    title: "Persistent Project Brain",
    desc: "8-layer memory system that genuinely knows your project across sessions. No repeated context needed -- it remembers everything.",
    icon: (
      <svg
        aria-hidden="true"
        className="h-6 w-6 text-green-400"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.5}
        viewBox="0 0 24 24"
      >
        <path
          d="M9.813 15.904 9 18.75l-.813-2.846a4.5 4.5 0 0 0-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 0 0 3.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 0 0 3.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 0 0-3.09 3.09ZM18.259 8.715 18 9.75l-.259-1.035a3.375 3.375 0 0 0-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 0 0 2.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 0 0 2.455 2.456L21.75 6l-1.036.259a3.375 3.375 0 0 0-2.455 2.456Z"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    ),
  },
  {
    title: "Real-Time Collaboration",
    desc: "Watch agents work in real-time with live terminal output, file diffs, and plan progress. Pause, resume, or take control at any time.",
    icon: (
      <svg
        aria-hidden="true"
        className="h-6 w-6 text-yellow-400"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.5}
        viewBox="0 0 24 24"
      >
        <path
          d="M3.75 13.5l10.5-11.25L12 10.5h8.25L9.75 21.75 12 13.5H3.75Z"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    ),
  },
  {
    title: "CI-Loop Architecture",
    desc: "Automatic test-fail-fix cycles with 80%+ auto-resolution rate. Your code is tested and fixed before you ever see it.",
    icon: (
      <svg
        aria-hidden="true"
        className="h-6 w-6 text-orange-400"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.5}
        viewBox="0 0 24 24"
      >
        <path
          d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0 3.181 3.183a8.25 8.25 0 0 0 13.803-3.7M4.031 9.865a8.25 8.25 0 0 1 13.803-3.7l3.181 3.182"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    ),
  },
  {
    title: "Privacy-First",
    desc: "Run entirely on your own infrastructure with local LLM models. Your code never leaves your network. Self-host everything.",
    icon: (
      <svg
        aria-hidden="true"
        className="h-6 w-6 text-red-400"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.5}
        viewBox="0 0 24 24"
      >
        <path
          d="M9 12.75 11.25 15 15 9.75m-3-7.036A11.959 11.959 0 0 1 3.598 6 11.99 11.99 0 0 0 3 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285Z"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    ),
  },
];

const STEPS = [
  {
    step: "01",
    title: "Describe",
    desc: "Tell PROMETHEUS what you want to build in plain English. Be as detailed or as vague as you like.",
  },
  {
    step: "02",
    title: "Plan",
    desc: "The Discovery agent elicits requirements, the Architect designs the system, and a detailed Blueprint is generated.",
  },
  {
    step: "03",
    title: "Build",
    desc: "12 agents work in parallel to build, test, and secure your project. Watch it happen in real-time.",
  },
];

const STATS = [
  { value: "12", label: "Specialist Agents" },
  { value: "80%+", label: "Auto-Fix Rate" },
  { value: "8", label: "Memory Layers" },
  { value: "< 5min", label: "To First Output" },
];

export default function HomePage() {
  return (
    <div>
      {/* Hero */}
      <section className="relative overflow-hidden py-32">
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-violet-900/20 via-zinc-950 to-zinc-950" />
        <div className="relative mx-auto max-w-4xl px-6 text-center">
          <div className="inline-flex items-center gap-2 rounded-full border border-violet-800/40 bg-violet-950/30 px-4 py-1.5 text-violet-400 text-xs">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-violet-400" />
            12 specialist AI agents, working in parallel
          </div>
          <h1 className="mt-8 font-bold text-5xl text-zinc-100 tracking-tight md:text-6xl lg:text-7xl">
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
          <p className="mt-4 text-xs text-zinc-600">
            50 credits free. No credit card required.
          </p>
        </div>
      </section>

      {/* Stats bar */}
      <section className="border-zinc-800 border-y bg-zinc-900/30">
        <div className="mx-auto grid max-w-6xl grid-cols-2 gap-8 px-6 py-12 md:grid-cols-4">
          {STATS.map((stat) => (
            <div className="text-center" key={stat.label}>
              <div className="font-bold text-3xl text-zinc-100">
                {stat.value}
              </div>
              <div className="mt-1 text-sm text-zinc-500">{stat.label}</div>
            </div>
          ))}
        </div>
      </section>

      {/* Feature highlights */}
      <section className="py-24">
        <div className="mx-auto max-w-6xl px-6">
          <h2 className="text-center font-bold text-3xl text-zinc-100">
            Why PROMETHEUS
          </h2>
          <p className="mx-auto mt-3 max-w-xl text-center text-zinc-500">
            Built different from every other AI coding tool.
          </p>
          <div className="mt-16 grid gap-6 md:grid-cols-2 lg:grid-cols-3">
            {FEATURES.map((feature) => (
              <div
                className="rounded-xl border border-zinc-800 bg-zinc-900/30 p-6 transition-colors hover:border-zinc-700"
                key={feature.title}
              >
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-zinc-800/50">
                  {feature.icon}
                </div>
                <h3 className="mt-4 font-semibold text-base text-zinc-200">
                  {feature.title}
                </h3>
                <p className="mt-2 text-sm text-zinc-500 leading-relaxed">
                  {feature.desc}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* How it works */}
      <section className="border-zinc-800 border-t py-24">
        <div className="mx-auto max-w-6xl px-6">
          <h2 className="text-center font-bold text-3xl text-zinc-100">
            How It Works
          </h2>
          <p className="mx-auto mt-3 max-w-xl text-center text-zinc-500">
            From idea to production in three steps.
          </p>
          <div className="mt-16 grid gap-8 md:grid-cols-3">
            {STEPS.map((s) => (
              <div className="relative text-center" key={s.step}>
                <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-violet-600/10 font-bold text-violet-400 text-xl">
                  {s.step}
                </div>
                <h3 className="mt-5 font-semibold text-lg text-zinc-200">
                  {s.title}
                </h3>
                <p className="mt-2 text-sm text-zinc-500 leading-relaxed">
                  {s.desc}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Agent grid */}
      <section className="border-zinc-800 border-t py-24">
        <div className="mx-auto max-w-6xl px-6">
          <h2 className="text-center font-bold text-3xl text-zinc-100">
            12 Specialist Agents
          </h2>
          <p className="mx-auto mt-3 max-w-xl text-center text-zinc-500">
            Each agent is an expert in its domain, working together to build
            production-ready software.
          </p>
          <div className="mt-12 grid gap-3 md:grid-cols-3 lg:grid-cols-4">
            {AGENTS.map((agent) => (
              <div
                className="rounded-xl border border-zinc-800 bg-zinc-900/30 p-4"
                key={agent.name}
              >
                <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-violet-600/10 font-bold text-violet-400 text-xs">
                  {agent.name[0]}
                </div>
                <h4 className="mt-3 font-semibold text-sm text-zinc-200">
                  {agent.name}
                </h4>
                <p className="mt-1 text-xs text-zinc-500">{agent.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Social proof / testimonial placeholder */}
      <section className="border-zinc-800 border-t py-24">
        <div className="mx-auto max-w-4xl px-6 text-center">
          <div className="rounded-2xl border border-zinc-800 bg-zinc-900/30 p-12">
            <p className="font-medium text-xl text-zinc-300 leading-relaxed">
              &ldquo;PROMETHEUS replaced our entire sprint planning and initial
              implementation cycle. What used to take a week now takes an
              afternoon.&rdquo;
            </p>
            <div className="mt-6 text-sm text-zinc-500">
              -- Engineering teams building with PROMETHEUS
            </div>
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="border-zinc-800 border-t py-24">
        <div className="mx-auto max-w-2xl px-6 text-center">
          <h2 className="font-bold text-3xl text-zinc-100">
            Ready to build faster?
          </h2>
          <p className="mt-3 text-zinc-500">
            Start with 50 free credits. No credit card required.
          </p>
          <div className="mt-8 flex justify-center gap-4">
            <Link
              className="inline-block rounded-xl bg-violet-600 px-8 py-3.5 font-semibold text-sm text-white transition-colors hover:bg-violet-700"
              href={"/sign-up" as Route}
            >
              Get Started Free
            </Link>
            <Link
              className="inline-block rounded-xl border border-zinc-700 bg-zinc-900 px-8 py-3.5 font-semibold text-sm text-zinc-300 transition-colors hover:bg-zinc-800"
              href="/pricing"
            >
              View Pricing
            </Link>
          </div>
        </div>
      </section>
    </div>
  );
}
