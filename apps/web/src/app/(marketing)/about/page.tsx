export default function AboutPage() {
  return (
    <div className="container py-24 max-w-3xl">
      <h1 className="text-4xl font-bold">About PROMETHEUS</h1>
      <div className="mt-8 space-y-6 text-muted-foreground">
        <p>
          PROMETHEUS is the first AI engineering platform that builds your entire project
          from requirements to production deployment using 12 specialist AI agents.
        </p>
        <h2 className="text-2xl font-semibold text-foreground">Why PROMETHEUS?</h2>
        <ul className="space-y-2">
          <li><strong>12 Specialist Agents</strong> — Not one generic AI, but dedicated agents for discovery, architecture, frontend, backend, testing, security, and deployment.</li>
          <li><strong>CI-Loop Architecture</strong> — Automatic test-fail-fix cycles with 80%+ auto-resolution rate.</li>
          <li><strong>Persistent Project Brain</strong> — 6-layer memory system that genuinely knows your project across sessions.</li>
          <li><strong>Real Production Deployment</strong> — Docker, Kubernetes, CI/CD — not just code files.</li>
          <li><strong>Privacy-First</strong> — Run entirely on your own infrastructure with local LLM models.</li>
        </ul>
        <h2 className="text-2xl font-semibold text-foreground">How It Works</h2>
        <ol className="space-y-2 list-decimal pl-5">
          <li>Describe what you want to build</li>
          <li>PROMETHEUS elicits requirements and generates a Blueprint</li>
          <li>12 agents work in parallel to build, test, and deploy</li>
          <li>CI-Loop auto-fixes test failures</li>
          <li>Security audit before every deployment</li>
          <li>Production-ready code delivered as a PR</li>
        </ol>
      </div>
    </div>
  );
}
