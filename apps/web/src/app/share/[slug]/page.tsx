import type { Metadata } from "next";
import { notFound } from "next/navigation";

// Force dynamic rendering — db import requires DATABASE_URL at runtime only
export const dynamic = "force-dynamic";

async function getDb() {
  const { db, projects } = await import("@prometheus/db");
  const { eq } = await import("drizzle-orm");
  return { db, projects, eq };
}

interface SharePageProps {
  params: Promise<{ slug: string }>;
}

async function getSharedProject(slug: string) {
  const { db, projects, eq } = await getDb();
  const project = await db.query.projects.findFirst({
    where: eq(projects.shareSlug, slug),
    with: {
      organization: { columns: { name: true } },
      settings: true,
    },
  });
  if (!project?.isPublic) {
    return null;
  }
  return project;
}

export async function generateMetadata({
  params,
}: SharePageProps): Promise<Metadata> {
  const { slug } = await params;
  const project = await getSharedProject(slug);
  if (!project) {
    return { title: "Project Not Found" };
  }
  return {
    title: `${project.name} - Prometheus`,
    description:
      project.description ?? `Shared Prometheus project: ${project.name}`,
  };
}

export default async function SharePage({ params }: SharePageProps) {
  const { slug } = await params;
  const project = await getSharedProject(slug);

  if (!project) {
    notFound();
  }

  return (
    <main className="mx-auto max-w-4xl px-4 py-12">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="font-bold text-3xl">{project.name}</h1>
          {project.organization?.name && (
            <p className="mt-1 text-gray-500 text-sm">
              by {project.organization.name}
            </p>
          )}
        </div>
        <div className="flex items-center gap-3">
          {project.forkCount > 0 && (
            <span className="rounded-full bg-gray-100 px-3 py-1 text-gray-600 text-sm">
              {project.forkCount} {project.forkCount === 1 ? "fork" : "forks"}
            </span>
          )}
          <a
            className="rounded-lg bg-blue-600 px-4 py-2 font-medium text-sm text-white hover:bg-blue-700"
            href={`/fork/${slug}`}
          >
            Fork Project
          </a>
        </div>
      </div>

      {project.description && (
        <p className="mt-4 text-gray-700 text-lg">{project.description}</p>
      )}

      <div className="mt-8 grid grid-cols-2 gap-6">
        <div className="rounded-lg border p-6">
          <h2 className="font-medium text-gray-500 text-sm">Tech Stack</h2>
          <p className="mt-2 font-semibold text-lg">
            {project.techStackPreset ?? "Not specified"}
          </p>
        </div>
        <div className="rounded-lg border p-6">
          <h2 className="font-medium text-gray-500 text-sm">Status</h2>
          <p className="mt-2 font-semibold text-lg capitalize">
            {project.status}
          </p>
        </div>
      </div>

      {project.settings && (
        <div className="mt-8 rounded-lg border p-6">
          <h2 className="mb-4 font-semibold text-lg">Project Settings</h2>
          <dl className="grid grid-cols-2 gap-4">
            <div>
              <dt className="text-gray-500 text-sm">Agent Mode</dt>
              <dd className="font-medium capitalize">
                {project.settings.agentAggressiveness}
              </dd>
            </div>
            <div>
              <dt className="text-gray-500 text-sm">Blueprint Enforcement</dt>
              <dd className="font-medium capitalize">
                {project.settings.blueprintEnforcement}
              </dd>
            </div>
            <div>
              <dt className="text-gray-500 text-sm">Test Coverage Target</dt>
              <dd className="font-medium">
                {project.settings.testCoverageTarget}%
              </dd>
            </div>
            <div>
              <dt className="text-gray-500 text-sm">Security Scan Level</dt>
              <dd className="font-medium capitalize">
                {project.settings.securityScanLevel}
              </dd>
            </div>
          </dl>
        </div>
      )}

      {project.repoUrl && (
        <div className="mt-8 rounded-lg border p-6">
          <h2 className="mb-2 font-semibold text-lg">Repository</h2>
          <a
            className="text-blue-600 hover:underline"
            href={project.repoUrl}
            rel="noopener noreferrer"
            target="_blank"
          >
            {project.repoUrl}
          </a>
        </div>
      )}

      <footer className="mt-12 border-t pt-6 text-center text-gray-500 text-sm">
        Shared via{" "}
        <a className="text-blue-600 hover:underline" href="/">
          Prometheus
        </a>{" "}
        AI Engineering Platform
      </footer>
    </main>
  );
}
