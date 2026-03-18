export default function ProjectsPage() {
  return (
    <div>
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Projects</h1>
        <a
          href="/dashboard/projects/new"
          className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
        >
          New Project
        </a>
      </div>
      <div className="mt-6 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        <div className="rounded-lg border border-dashed p-8 text-center text-muted-foreground">
          <p>No projects yet.</p>
          <p className="mt-2 text-sm">Create your first project to get started.</p>
        </div>
      </div>
    </div>
  );
}
