import { Skeleton } from "@prometheus/ui";

export default function FeaturesLoading() {
  return (
    <div className="mx-auto max-w-6xl space-y-8 px-4 py-16">
      <div className="text-center">
        <Skeleton className="mx-auto h-10 w-48" />
        <Skeleton className="mx-auto mt-4 h-5 w-96" />
      </div>
      <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
        <Skeleton className="h-48" />
        <Skeleton className="h-48" />
        <Skeleton className="h-48" />
        <Skeleton className="h-48" />
        <Skeleton className="h-48" />
        <Skeleton className="h-48" />
      </div>
    </div>
  );
}
