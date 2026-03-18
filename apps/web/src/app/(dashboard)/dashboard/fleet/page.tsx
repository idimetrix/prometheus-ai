export default function FleetPage() {
  return (
    <div>
      <h1 className="text-2xl font-bold">Fleet Manager</h1>
      <p className="mt-2 text-muted-foreground">Monitor and manage your parallel AI agents.</p>

      <div className="mt-6 grid gap-4 md:grid-cols-3">
        <div className="rounded-lg border p-4">
          <div className="text-sm text-muted-foreground">Active Agents</div>
          <div className="mt-1 text-2xl font-bold">0</div>
        </div>
        <div className="rounded-lg border p-4">
          <div className="text-sm text-muted-foreground">Queued Tasks</div>
          <div className="mt-1 text-2xl font-bold">0</div>
        </div>
        <div className="rounded-lg border p-4">
          <div className="text-sm text-muted-foreground">Credits Used Today</div>
          <div className="mt-1 text-2xl font-bold">0</div>
        </div>
      </div>

      <div className="mt-6">
        <h2 className="text-lg font-semibold mb-4">Agent Grid</h2>
        <div className="rounded-lg border border-dashed p-8 text-center text-muted-foreground">
          No active agents. Start a task to see agents here.
        </div>
      </div>
    </div>
  );
}
