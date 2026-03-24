import { Skeleton } from "@prometheus/ui";

export default function ProjectSessionLoading() {
  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b p-4">
        <div className="flex items-center gap-3">
          <Skeleton className="h-6 w-6 rounded-full" />
          <Skeleton className="h-6 w-48" />
        </div>
        <Skeleton className="h-8 w-20" />
      </div>
      <div className="grid flex-1 grid-cols-1 md:grid-cols-3">
        <div className="col-span-2 space-y-4 p-4">
          <Skeleton className="h-16" />
          <Skeleton className="h-16" />
          <Skeleton className="h-32" />
        </div>
        <div className="space-y-4 border-l p-4">
          <Skeleton className="h-48" />
          <Skeleton className="h-32" />
        </div>
      </div>
    </div>
  );
}
