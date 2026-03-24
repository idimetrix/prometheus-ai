import { Skeleton } from "@prometheus/ui";

export default function CreateLoading() {
  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <Skeleton className="h-8 w-48" />
      <Skeleton className="h-12 w-full" />
      <Skeleton className="h-32 w-full" />
      <Skeleton className="h-12 w-full" />
      <Skeleton className="h-9 w-32" />
    </div>
  );
}
