import { Skeleton } from "@prometheus/ui";

export default function ReplayLoading() {
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <Skeleton className="h-5 w-5" />
        <Skeleton className="h-5 w-40" />
      </div>
      <div className="flex gap-4">
        <div className="flex-1 space-y-3">
          <Skeleton className="h-[calc(100vh-16rem)] w-full rounded-lg" />
          <div className="flex items-center gap-3">
            <Skeleton className="h-8 w-8 rounded" />
            <Skeleton className="h-8 w-8 rounded" />
            <Skeleton className="h-2 flex-1 rounded-full" />
            <Skeleton className="h-4 w-20" />
          </div>
        </div>
        <div className="w-64 space-y-2">
          <Skeleton className="h-5 w-20" />
          <Skeleton className="h-12 w-full rounded" />
          <Skeleton className="h-12 w-full rounded" />
          <Skeleton className="h-12 w-full rounded" />
          <Skeleton className="h-12 w-full rounded" />
        </div>
      </div>
    </div>
  );
}
