import { Card, CardContent, Skeleton } from "@prometheus/ui";

const STAT_KEYS = ["stat-0", "stat-1", "stat-2", "stat-3"];
const SESSION_KEYS = ["session-0", "session-1", "session-2"];
const PROJECT_KEYS = ["project-0", "project-1", "project-2"];

export default function DashboardLoading() {
  return (
    <div className="space-y-8">
      {/* Header skeleton */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <Skeleton className="h-7 w-32" />
          <Skeleton className="mt-2 h-4 w-56" />
        </div>
        <div className="flex gap-3">
          <Skeleton className="h-10 w-28" />
          <Skeleton className="h-10 w-24" />
        </div>
      </div>

      {/* Stats grid skeleton */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {STAT_KEYS.map((key) => (
          <Card className="border-zinc-800 bg-zinc-900/50 p-5" key={key}>
            <CardContent className="p-0">
              <div className="flex items-center gap-2">
                <Skeleton className="h-8 w-8 rounded-lg" />
                <Skeleton className="h-3 w-24" />
              </div>
              <Skeleton className="mt-3 h-8 w-16" />
              <Skeleton className="mt-2 h-3 w-28" />
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Sessions skeleton */}
      <div>
        <Skeleton className="mb-4 h-6 w-36" />
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {SESSION_KEYS.map((key) => (
            <Card className="border-zinc-800 bg-zinc-900/50 p-4" key={key}>
              <CardContent className="p-0">
                <div className="flex items-center justify-between">
                  <Skeleton className="h-3 w-14" />
                  <Skeleton className="h-3 w-20" />
                </div>
                <Skeleton className="mt-3 h-4 w-32" />
                <Skeleton className="mt-2 h-3 w-20" />
              </CardContent>
            </Card>
          ))}
        </div>
      </div>

      {/* Projects skeleton */}
      <div>
        <Skeleton className="mb-4 h-6 w-36" />
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {PROJECT_KEYS.map((key) => (
            <Card className="border-zinc-800 bg-zinc-900/50 p-5" key={key}>
              <CardContent className="p-0">
                <Skeleton className="h-4 w-16" />
                <Skeleton className="mt-3 h-5 w-40" />
                <Skeleton className="mt-2 h-3 w-full" />
                <Skeleton className="mt-1 h-3 w-3/4" />
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    </div>
  );
}
