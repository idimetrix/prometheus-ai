import { Skeleton } from "@prometheus/ui";

const SESSION_KEYS = ["sess-0", "sess-1", "sess-2", "sess-3"];

export default function ProjectSessionsLoading() {
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <Skeleton className="h-8 w-32" />
      </div>
      <div className="flex gap-2">
        <Skeleton className="h-8 w-16" />
        <Skeleton className="h-8 w-20" />
        <Skeleton className="h-8 w-24" />
      </div>
      <div className="space-y-2">
        {SESSION_KEYS.map((key) => (
          <div
            className="flex items-center gap-4 rounded-lg border border-zinc-800 bg-zinc-900/50 p-4"
            key={key}
          >
            <Skeleton className="h-8 w-8 rounded-full" />
            <div className="flex-1 space-y-2">
              <Skeleton className="h-4 w-48" />
              <Skeleton className="h-3 w-32" />
            </div>
            <Skeleton className="h-5 w-16 rounded-full" />
            <Skeleton className="h-4 w-20" />
          </div>
        ))}
      </div>
    </div>
  );
}
