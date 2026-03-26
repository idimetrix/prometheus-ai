import { Skeleton } from "@prometheus/ui";

const PLAYBOOK_KEYS = ["pb-0", "pb-1", "pb-2", "pb-3", "pb-4", "pb-5"];

export default function PlaybooksLoading() {
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <Skeleton className="h-8 w-32" />
        <Skeleton className="h-9 w-36" />
      </div>
      <div className="flex gap-2">
        <Skeleton className="h-8 w-16" />
        <Skeleton className="h-8 w-20" />
        <Skeleton className="h-8 w-24" />
      </div>
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {PLAYBOOK_KEYS.map((key) => (
          <div
            className="space-y-3 rounded-lg border border-zinc-800 bg-zinc-900/50 p-5"
            key={key}
          >
            <div className="flex items-center gap-3">
              <Skeleton className="h-9 w-9 rounded-lg" />
              <Skeleton className="h-5 w-36" />
            </div>
            <Skeleton className="h-3 w-full" />
            <Skeleton className="h-3 w-2/3" />
            <div className="flex items-center justify-between pt-2">
              <Skeleton className="h-5 w-20 rounded-full" />
              <Skeleton className="h-8 w-16" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
