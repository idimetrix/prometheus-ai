export default function AnalyticsPage() {
  return (
    <div>
      <h1 className="text-2xl font-bold">Analytics</h1>
      <p className="mt-2 text-muted-foreground">Track your usage, costs, and productivity.</p>

      <div className="mt-6 grid gap-4 md:grid-cols-4">
        <div className="rounded-lg border p-4">
          <div className="text-sm text-muted-foreground">Tasks This Month</div>
          <div className="mt-1 text-2xl font-bold">0</div>
        </div>
        <div className="rounded-lg border p-4">
          <div className="text-sm text-muted-foreground">Credits Used</div>
          <div className="mt-1 text-2xl font-bold">0</div>
        </div>
        <div className="rounded-lg border p-4">
          <div className="text-sm text-muted-foreground">Avg Task Duration</div>
          <div className="mt-1 text-2xl font-bold">--</div>
        </div>
        <div className="rounded-lg border p-4">
          <div className="text-sm text-muted-foreground">Success Rate</div>
          <div className="mt-1 text-2xl font-bold">--</div>
        </div>
      </div>

      <div className="mt-8 rounded-lg border p-6 text-center text-muted-foreground">
        Charts will appear here once you start using PROMETHEUS.
      </div>
    </div>
  );
}
