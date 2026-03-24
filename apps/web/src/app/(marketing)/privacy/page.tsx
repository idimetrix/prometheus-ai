export default function PrivacyPage() {
  return (
    <div className="mx-auto max-w-3xl px-6 py-20">
      <h1 className="mb-8 font-bold text-4xl text-zinc-100 tracking-tight">
        Privacy Policy
      </h1>
      <p className="mb-8 text-sm text-zinc-500">Last updated: March 24, 2026</p>

      <div className="space-y-8 text-zinc-400">
        <section>
          <h2 className="mb-3 font-semibold text-xl text-zinc-200">
            1. Information We Collect
          </h2>
          <p>
            When you use PROMETHEUS, we collect information necessary to provide
            and improve our service:
          </p>
          <ul className="mt-3 list-disc space-y-2 pl-6">
            <li>
              <strong className="text-zinc-300">Account Information:</strong>{" "}
              Name, email address, and organization details provided during
              registration.
            </li>
            <li>
              <strong className="text-zinc-300">Usage Data:</strong> Session
              metadata, task configurations, credit consumption, and feature
              usage patterns.
            </li>
            <li>
              <strong className="text-zinc-300">Payment Information:</strong>{" "}
              Processed securely through Stripe. We never store full payment
              card details.
            </li>
          </ul>
        </section>

        <section>
          <h2 className="mb-3 font-semibold text-xl text-zinc-200">
            2. Your Code and Data
          </h2>
          <p>
            PROMETHEUS processes your code to execute tasks. We are committed to
            protecting your intellectual property:
          </p>
          <ul className="mt-3 list-disc space-y-2 pl-6">
            <li>
              Your code is processed in isolated sandboxed environments and is
              never used to train AI models.
            </li>
            <li>
              Session artifacts (generated code, logs, plans) are stored
              encrypted at rest and deleted upon your request.
            </li>
            <li>
              Self-hosted deployments keep all data entirely on your
              infrastructure &mdash; nothing is transmitted to our servers.
            </li>
          </ul>
        </section>

        <section>
          <h2 className="mb-3 font-semibold text-xl text-zinc-200">
            3. Third-Party Services
          </h2>
          <p>We use the following third-party services:</p>
          <ul className="mt-3 list-disc space-y-2 pl-6">
            <li>
              <strong className="text-zinc-300">Clerk</strong> &mdash;
              Authentication and user management.
            </li>
            <li>
              <strong className="text-zinc-300">Stripe</strong> &mdash; Payment
              processing.
            </li>
            <li>
              <strong className="text-zinc-300">LLM Providers</strong> &mdash;
              When using cloud models, prompts are sent to the selected provider
              (Anthropic, OpenAI, Google, etc.) under their respective privacy
              policies. Use local models via Ollama to avoid this entirely.
            </li>
          </ul>
        </section>

        <section>
          <h2 className="mb-3 font-semibold text-xl text-zinc-200">
            4. Data Retention
          </h2>
          <p>
            We retain your data for as long as your account is active. Upon
            account deletion, all personal data and session artifacts are
            permanently removed within 30 days. You may request data export or
            deletion at any time via the Settings page or by contacting us.
          </p>
        </section>

        <section>
          <h2 className="mb-3 font-semibold text-xl text-zinc-200">
            5. Security
          </h2>
          <p>
            We implement industry-standard security measures including
            encryption at rest and in transit (TLS 1.3), isolated execution
            environments, role-based access control, and regular security
            audits. Enterprise plans include SOC 2 Type II compliance and custom
            SLA agreements.
          </p>
        </section>

        <section>
          <h2 className="mb-3 font-semibold text-xl text-zinc-200">
            6. Contact
          </h2>
          <p>
            For privacy-related inquiries, contact us at{" "}
            <span className="text-violet-400">privacy@prometheus.dev</span>.
          </p>
        </section>
      </div>
    </div>
  );
}
