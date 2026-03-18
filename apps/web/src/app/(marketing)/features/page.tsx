import Link from "next/link";

const FEATURE_SECTIONS = [
  {
    title: "12 Specialist AI Agents",
    desc: "Each agent is an expert in its domain, purpose-built for a specific part of the software development lifecycle.",
    details: [
      "Discovery Agent -- Elicits requirements, clarifies ambiguity, generates user stories",
      "Architect Agent -- Designs system architecture, API contracts, data models",
      "Frontend Agent -- Builds UIs with React, Vue, Svelte, or any framework",
      "Backend Agent -- Implements APIs, services, business logic, and integrations",
      "Database Agent -- Designs schemas, writes migrations, optimizes queries",
      "DevOps Agent -- Configures Docker, Kubernetes, CI/CD pipelines",
      "Testing Agent -- Writes unit, integration, and e2e test suites",
      "Security Agent -- Audits code for vulnerabilities, applies fixes",
      "Documentation Agent -- Generates READMEs, API docs, architecture diagrams",
      "CI-Loop Agent -- Auto-fixes failing tests and builds",
      "Deployment Agent -- Pushes to staging and production environments",
      "Orchestrator -- Coordinates all agents, manages execution plans",
    ],
  },
  {
    title: "Multi-Model Intelligence",
    desc: "PROMETHEUS intelligently routes each task to the best LLM for the job.",
    details: [
      "Supports Anthropic Claude, OpenAI GPT-4, Google Gemini, Groq, Cerebras",
      "Local model support via Ollama (Llama, CodeStral, Mistral)",
      "Automatic model selection based on task type and complexity",
      "Bring Your Own Key (BYOK) -- use your own API keys",
      "Cost-optimized routing to minimize credit usage",
      "Fallback chains for reliability",
    ],
  },
  {
    title: "Persistent Project Brain",
    desc: "A 6-layer memory system that genuinely knows your project across sessions.",
    details: [
      "Semantic Memory -- understands code meaning and relationships",
      "Episodic Memory -- remembers past sessions and decisions",
      "Procedural Memory -- learns your build/test/deploy procedures",
      "Architectural Memory -- knows your system architecture",
      "Convention Memory -- learns your coding style and patterns",
      "Working Memory -- maintains context during active sessions",
    ],
  },
  {
    title: "Real-Time Collaboration",
    desc: "Watch agents work live and intervene whenever you want.",
    details: [
      "Live terminal output streaming via SSE",
      "Real-time file tree updates as agents create and modify files",
      "Plan progress tracking with step-by-step visibility",
      "Code diff viewer showing every change",
      "Pause, resume, and cancel sessions at any time",
      "Take manual control and hand back to agents",
    ],
  },
  {
    title: "CI-Loop Architecture",
    desc: "Automatic test-fail-fix cycles that ensure code quality.",
    details: [
      "Runs tests after every code generation step",
      "Automatically detects and fixes failing tests",
      "80%+ auto-resolution rate for common test failures",
      "Configurable max iterations to control costs",
      "Detailed logs of every fix attempt",
      "Security audit gate before deployment",
    ],
  },
  {
    title: "Fleet Mode",
    desc: "Deploy multiple agents in parallel for maximum throughput.",
    details: [
      "Run up to 100 agents simultaneously (Enterprise plan)",
      "Visual fleet manager with agent status grid",
      "Per-agent resource monitoring (tokens, steps, time)",
      "Task queue with priority scheduling",
      "Stop individual agents or the entire fleet",
      "Credit usage tracking per agent",
    ],
  },
];

export default function FeaturesPage() {
  return (
    <div className="py-24">
      <div className="mx-auto max-w-5xl px-6">
        {/* Header */}
        <div className="text-center">
          <h1 className="font-bold text-4xl text-zinc-100">Features</h1>
          <p className="mx-auto mt-4 max-w-2xl text-lg text-zinc-500">
            Everything you need to build production-ready software with AI
            agents.
          </p>
        </div>

        {/* Feature sections */}
        <div className="mt-16 space-y-16">
          {FEATURE_SECTIONS.map((section, idx) => (
            <div key={section.title}>
              <div className="flex items-start gap-4">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-violet-600/10 font-bold text-lg text-violet-400">
                  {idx + 1}
                </div>
                <div>
                  <h2 className="font-semibold text-2xl text-zinc-200">
                    {section.title}
                  </h2>
                  <p className="mt-2 text-sm text-zinc-500 leading-relaxed">
                    {section.desc}
                  </p>
                </div>
              </div>
              <div className="mt-6 ml-14 grid gap-2 md:grid-cols-2">
                {section.details.map((detail, i) => (
                  <div
                    className="flex items-start gap-2 rounded-lg border border-zinc-800 bg-zinc-900/30 px-4 py-3"
                    key={i}
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
              href="/sign-up"
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
