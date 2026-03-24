import { Skeleton } from "@prometheus/ui";

export default function NewTaskLoading() {
  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <Skeleton className="h-8 w-36" />
      <Skeleton className="h-4 w-64" />
      <Skeleton className="h-32 w-full" />
      <Skeleton className="h-9 w-32" />
    </div>
  );
}
