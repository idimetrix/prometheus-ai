export default function DashboardPage() {
  return (
    <div>
      <h1 className="text-2xl font-bold">Dashboard</h1>
      <p className="mt-2 text-muted-foreground">
        Welcome to PROMETHEUS. Your AI engineering platform.
      </p>
      <div className="mt-8 grid gap-6 md:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-lg border p-6">
          <div className="text-sm text-muted-foreground">Active Agents</div>
          <div className="mt-2 text-3xl font-bold">0</div>
        </div>
        <div className="rounded-lg border p-6">
          <div className="text-sm text-muted-foreground">Credits</div>
          <div className="mt-2 text-3xl font-bold">50</div>
        </div>
        <div className="rounded-lg border p-6">
          <div className="text-sm text-muted-foreground">Projects</div>
          <div className="mt-2 text-3xl font-bold">0</div>
        </div>
        <div className="rounded-lg border p-6">
          <div className="text-sm text-muted-foreground">Tasks Today</div>
          <div className="mt-2 text-3xl font-bold">0</div>
        </div>
      </div>
    </div>
  );
}
