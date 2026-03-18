export default function AboutPage() {
  return (
    <div className="mx-auto max-w-3xl px-6 py-24">
      <h1 className="text-4xl font-bold text-zinc-100">About PROMETHEUS</h1>
      <div className="mt-8 space-y-8">
        <p className="text-lg leading-relaxed text-zinc-400">
          PROMETHEUS is the first AI engineering platform that builds your
          entire project from requirements to production deployment using 12
          specialist AI agents.
        </p>

        <div>
          <h2 className="text-2xl font-semibold text-zinc-200">
            Why PROMETHEUS?
          </h2>
          <div className="mt-4 space-y-3">
            {[
              {
                title: "12 Specialist Agents",
                desc: "Not one generic AI, but dedicated agents for discovery, architecture, frontend, backend, testing, security, and deployment.",
              },
              {
                title: "CI-Loop Architecture",
                desc: "Automatic test-fail-fix cycles with 80%+ auto-resolution rate.",
              },
              {
                title: "Persistent Project Brain",
                desc: "6-layer memory system that genuinely knows your project across sessions.",
              },
              {
                title: "Real Production Deployment",
                desc: "Docker, Kubernetes, CI/CD -- not just code files.",
              },
              {
                title: "Privacy-First",
                desc: "Run entirely on your own infrastructure with local LLM models.",
              },
            ].map((item) => (
              <div
                key={item.title}
                className="rounded-xl border border-zinc-800 bg-zinc-900/30 p-4"
              >
                <h3 className="text-sm font-semibold text-zinc-200">
                  {item.title}
                </h3>
                <p className="mt-1 text-sm text-zinc-500">{item.desc}</p>
              </div>
            ))}
          </div>
        </div>

        <div>
          <h2 className="text-2xl font-semibold text-zinc-200">How It Works</h2>
          <div className="mt-4 space-y-3">
            {[
              "Describe what you want to build",
              "PROMETHEUS elicits requirements and generates a Blueprint",
              "12 agents work in parallel to build, test, and deploy",
              "CI-Loop auto-fixes test failures",
              "Security audit before every deployment",
              "Production-ready code delivered as a PR",
            ].map((step, i) => (
              <div
                key={i}
                className="flex items-center gap-3 rounded-lg border border-zinc-800 bg-zinc-900/30 px-4 py-3"
              >
                <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-violet-600/10 text-xs font-bold text-violet-400">
                  {i + 1}
                </div>
                <span className="text-sm text-zinc-300">{step}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
