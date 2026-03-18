export default function SettingsPage() {
  return (
    <div className="max-w-3xl">
      <h1 className="text-2xl font-bold">Settings</h1>

      <div className="mt-6 space-y-8">
        <section>
          <h2 className="text-lg font-semibold">Organization</h2>
          <div className="mt-4 rounded-lg border p-4 text-sm text-muted-foreground">
            Organization settings will be managed through Clerk.
          </div>
        </section>

        <section>
          <h2 className="text-lg font-semibold">Billing</h2>
          <div className="mt-4 rounded-lg border p-4">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-sm font-medium">Current Plan: Hobby (Free)</div>
                <div className="text-sm text-muted-foreground">50 credits included</div>
              </div>
              <button className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground">
                Upgrade
              </button>
            </div>
          </div>
        </section>

        <section>
          <h2 className="text-lg font-semibold">API Keys</h2>
          <div className="mt-4 rounded-lg border p-4 text-sm text-muted-foreground">
            No API keys created yet.
          </div>
        </section>

        <section>
          <h2 className="text-lg font-semibold">Model Preferences</h2>
          <div className="mt-4 rounded-lg border p-4 text-sm text-muted-foreground">
            Default model routing is used. Bring your own API keys to customize.
          </div>
        </section>
      </div>
    </div>
  );
}
