import type { Route } from "next";
import Link from "next/link";

const AGENTS = [
  {
    name: "Discovery",
    icon: "D",
    color: "text-violet-400 bg-violet-600/10",
    desc: "Elicits requirements, clarifies ambiguity, and generates structured user stories from natural language descriptions.",
  },
  {
    name: "Architect",
    icon: "A",
    color: "text-blue-400 bg-blue-600/10",
    desc: "Designs system architecture, API contracts, data models, and generates detailed implementation blueprints.",
  },
  {
    name: "Frontend",
    icon: "F",
    color: "text-cyan-400 bg-cyan-600/10",
    desc: "Builds UIs with React, Vue, Svelte, or any framework. Handles components, layouts, styling, and accessibility.",
  },
  {
    name: "Backend",
    icon: "B",
    color: "text-green-400 bg-green-600/10",
    desc: "Implements APIs, services, business logic, and third-party integrations with production-grade error handling.",
  },
  {
    name: "Database",
    icon: "D",
    color: "text-emerald-400 bg-emerald-600/10",
    desc: "Designs schemas, writes migrations, optimizes queries, and manages indexes for PostgreSQL, MySQL, and more.",
  },
  {
    name: "DevOps",
    icon: "O",
    color: "text-yellow-400 bg-yellow-600/10",
    desc: "Configures Docker, Kubernetes, CI/CD pipelines, and infrastructure-as-code for any cloud provider.",
  },
  {
    name: "Testing",
    icon: "T",
    color: "text-orange-400 bg-orange-600/10",
    desc: "Writes unit, integration, and end-to-end test suites with comprehensive coverage and meaningful assertions.",
  },
  {
    name: "Security",
    icon: "S",
    color: "text-red-400 bg-red-600/10",
    desc: "Audits code for vulnerabilities, applies fixes, enforces OWASP best practices, and gates deployments.",
  },
  {
    name: "Documentation",
    icon: "D",
    color: "text-pink-400 bg-pink-600/10",
    desc: "Generates READMEs, API docs, architecture diagrams, changelogs, and inline code documentation.",
  },
  {
    name: "CI-Loop",
    icon: "C",
    color: "text-amber-400 bg-amber-600/10",
    desc: "Monitors test results and automatically fixes failing tests and builds with 80%+ auto-resolution rate.",
  },
  {
    name: "Deployment",
    icon: "D",
    color: "text-teal-400 bg-teal-600/10",
    desc: "Pushes to staging and production environments, manages rollbacks, and verifies deployment health.",
  },
  {
    name: "Orchestrator",
    icon: "O",
    color: "text-purple-400 bg-purple-600/10",
    desc: "Coordinates all agents, manages execution plans, handles task dependencies, and optimizes agent allocation.",
  },
];

const FEATURE_SECTIONS = [
  {
    title: "Multi-Agent Orchestration",
    desc: "Three orchestration strategies let you match execution to the task at hand.",
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
          d="M7.5 21 3 16.5m0 0L7.5 12M3 16.5h13.5m0-13.5L21 7.5m0 0L16.5 12M21 7.5H7.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    ),
    details: [
      "Mixture-of-Agents (MoA) -- multiple agents collaborate on a single task for higher quality output",
      "Parallel execution -- independent agents work simultaneously for maximum throughput",
      "Agent composition -- chain agents sequentially where each builds on the previous output",
      "Dynamic task routing -- Orchestrator assigns tasks to the best-suited agent automatically",
      "Priority scheduling -- critical tasks jump the queue while background work continues",
      "Fleet mode -- run up to 100 agents simultaneously on Enterprise plans",
    ],
  },
  {
    title: "8-Layer Memory System",
    desc: "A persistent brain that genuinely knows your project across sessions. No repeated context needed.",
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
    details: [
      "Semantic Memory -- understands code meaning, relationships, and intent",
      "Episodic Memory -- remembers past sessions, decisions, and outcomes",
      "Procedural Memory -- learns your build, test, and deploy procedures",
      "Architectural Memory -- knows your system architecture and design patterns",
      "Convention Memory -- learns your coding style, naming, and formatting preferences",
      "Working Memory -- maintains rich context during active sessions",
      "Relational Memory -- tracks dependencies between files, modules, and services",
      "Temporal Memory -- understands project evolution and change history",
    ],
  },
  {
    title: "9-Provider Model Routing",
    desc: "PROMETHEUS intelligently routes each task to the best LLM provider for the job.",
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
          d="M8.25 3v1.5M4.5 8.25H3m18 0h-1.5M4.5 12H3m18 0h-1.5m-15 3.75H3m18 0h-1.5M8.25 19.5V21M12 3v1.5m0 15V21m3.75-18v1.5m0 15V21m-9-1.5h10.5a2.25 2.25 0 0 0 2.25-2.25V6.75a2.25 2.25 0 0 0-2.25-2.25H6.75A2.25 2.25 0 0 0 4.5 6.75v10.5a2.25 2.25 0 0 0 2.25 2.25Z"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    ),
    details: [
      "Anthropic Claude -- premium reasoning and code generation",
      "OpenAI GPT-4 -- broad general-purpose capabilities",
      "Google Gemini -- large context window processing",
      "Groq -- ultra-fast inference for latency-sensitive tasks",
      "Cerebras -- wafer-scale inference engine",
      "Ollama local models -- Llama, CodeStral, Mistral, and more",
      "Bring Your Own Key (BYOK) -- use your own API keys for any provider",
      "Cost-optimized routing -- automatically minimizes credit usage",
      "Fallback chains -- if one provider is down, tasks route to the next best option",
    ],
  },
  {
    title: "Self-Hosted and Air-Gapped",
    desc: "Deploy PROMETHEUS entirely on your own infrastructure. Your code never leaves your network.",
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
    details: [
      "Docker and Kubernetes deployment -- single command setup",
      "Air-gapped environments -- no external network access required",
      "Local LLM support -- run models entirely on your hardware",
      "Data sovereignty -- all data stored on your infrastructure",
      "Compliance ready -- HIPAA, SOC 2, GDPR compatible deployments",
      "Custom TLS certificates and SSO integration",
    ],
  },
  {
    title: "Real-Time Collaboration",
    desc: "Watch agents work in real-time and intervene whenever you want.",
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
    details: [
      "Live terminal output streaming via Server-Sent Events",
      "Real-time file tree updates as agents create and modify files",
      "Plan progress tracking with step-by-step visibility",
      "Code diff viewer showing every change in context",
      "Pause, resume, and cancel sessions at any time",
      "Take manual control and hand back to agents seamlessly",
    ],
  },
  {
    title: "Plugin Marketplace",
    desc: "Extend PROMETHEUS with community and first-party plugins for any workflow.",
    icon: (
      <svg
        aria-hidden="true"
        className="h-6 w-6 text-cyan-400"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.5}
        viewBox="0 0 24 24"
      >
        <path
          d="M14.25 6.087c0-.355.186-.676.401-.959.221-.29.349-.634.349-1.003 0-1.036-1.007-1.875-2.25-1.875s-2.25.84-2.25 1.875c0 .369.128.713.349 1.003.215.283.401.604.401.959v0a.64.64 0 0 1-.657.643 48.39 48.39 0 0 1-4.163-.3c.186 1.613.293 3.25.315 4.907a.656.656 0 0 1-.658.663v0c-.355 0-.676-.186-.959-.401a1.647 1.647 0 0 0-1.003-.349c-1.036 0-1.875 1.007-1.875 2.25s.84 2.25 1.875 2.25c.369 0 .713-.128 1.003-.349.283-.215.604-.401.959-.401v0c.31 0 .555.26.532.57a48.039 48.039 0 0 1-.642 5.056c1.518.19 3.058.309 4.616.354a.64.64 0 0 0 .657-.643v0c0-.355-.186-.676-.401-.959a1.647 1.647 0 0 1-.349-1.003c0-1.035 1.008-1.875 2.25-1.875 1.243 0 2.25.84 2.25 1.875 0 .369-.128.713-.349 1.003-.215.283-.4.604-.4.959v0c0 .333.277.599.61.58a48.1 48.1 0 0 0 5.427-.63 48.05 48.05 0 0 0 .582-4.717.532.532 0 0 0-.533-.57v0c-.355 0-.676.186-.959.401-.29.221-.634.349-1.003.349-1.035 0-1.875-1.007-1.875-2.25s.84-2.25 1.875-2.25c.37 0 .713.128 1.003.349.283.215.604.401.96.401v0a.656.656 0 0 0 .658-.663 48.422 48.422 0 0 0-.37-5.36c-1.886.342-3.81.574-5.766.689a.578.578 0 0 1-.61-.58v0Z"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    ),
    details: [
      "MCP Gateway for Model Context Protocol integrations",
      "GitHub, GitLab, and Bitbucket source control connectors",
      "Jira, Linear, and Notion project management integrations",
      "Slack and Discord notification channels",
      "VS Code extension for in-editor agent interaction",
      "Custom plugin SDK for building your own integrations",
    ],
  },
];

export default function FeaturesPage() {
  return (
    <div className="py-24">
      <div className="mx-auto max-w-6xl px-6">
        {/* Header */}
        <div className="text-center">
          <h1 className="font-bold text-4xl text-zinc-100 tracking-tight md:text-5xl">
            Everything You Need to Build
            <br />
            <span className="bg-gradient-to-r from-violet-400 to-purple-400 bg-clip-text text-transparent">
              Production-Ready Software
            </span>
          </h1>
          <p className="mx-auto mt-4 max-w-2xl text-lg text-zinc-500">
            12 specialist agents, 9 model providers, 8 memory layers, and an
            orchestration engine that coordinates it all.
          </p>
        </div>

        {/* 12 Specialist Agents Grid */}
        <div className="mt-20">
          <div className="text-center">
            <h2 className="font-bold text-2xl text-zinc-100">
              12 Specialist AI Agents
            </h2>
            <p className="mx-auto mt-2 max-w-xl text-zinc-500">
              Not one generic AI. Dedicated agents for every phase of the
              software development lifecycle.
            </p>
          </div>
          <div className="mt-10 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {AGENTS.map((agent) => (
              <div
                className="rounded-xl border border-zinc-800 bg-zinc-900/30 p-5 transition-colors hover:border-zinc-700"
                key={agent.name}
              >
                <div className="flex items-center gap-3">
                  <div
                    className={`flex h-9 w-9 items-center justify-center rounded-lg font-bold text-sm ${agent.color}`}
                  >
                    {agent.icon}
                  </div>
                  <h3 className="font-semibold text-base text-zinc-200">
                    {agent.name}
                  </h3>
                </div>
                <p className="mt-3 text-sm text-zinc-500 leading-relaxed">
                  {agent.desc}
                </p>
              </div>
            ))}
          </div>
        </div>

        {/* Feature deep-dive sections */}
        <div className="mt-24 space-y-20">
          {FEATURE_SECTIONS.map((section, idx) => (
            <div key={section.title}>
              <div className="flex items-start gap-4">
                <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-zinc-800/50">
                  {section.icon}
                </div>
                <div>
                  <h2 className="font-semibold text-2xl text-zinc-200">
                    {section.title}
                  </h2>
                  <p className="mt-2 max-w-2xl text-sm text-zinc-500 leading-relaxed">
                    {section.desc}
                  </p>
                </div>
              </div>
              <div className="mt-6 ml-16 grid gap-2 md:grid-cols-2">
                {section.details.map((detail) => (
                  <div
                    className="flex items-start gap-2 rounded-lg border border-zinc-800 bg-zinc-900/30 px-4 py-3"
                    key={detail}
                  >
                    <svg
                      aria-hidden="true"
                      className="mt-0.5 h-4 w-4 shrink-0 text-green-500"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth={2}
                      viewBox="0 0 24 24"
                    >
                      <path
                        d="m4.5 12.75 6 6 9-13.5"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                    <span className="text-sm text-zinc-400">{detail}</span>
                  </div>
                ))}
              </div>
              {idx < FEATURE_SECTIONS.length - 1 && (
                <div className="mt-20 border-zinc-800/50 border-b" />
              )}
            </div>
          ))}
        </div>

        {/* CTA */}
        <div className="mt-24 text-center">
          <h2 className="font-bold text-2xl text-zinc-100">
            See all features in action
          </h2>
          <p className="mt-2 text-zinc-500">
            50 free credits to explore every feature. No credit card required.
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
