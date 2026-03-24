import { Skeleton } from "@prometheus/ui";

export default function MarketingLoading() {
  return (
    <div className="mx-auto max-w-6xl space-y-12 px-4 py-16">
      <div className="text-center">
        <Skeleton className="mx-auto h-12 w-64" />
        <Skeleton className="mx-auto mt-4 h-6 w-96" />
      </div>
      <div className="grid gap-8 md:grid-cols-3">
        <Skeleton className="h-48" />
        <Skeleton className="h-48" />
        <Skeleton className="h-48" />
      </div>
      <Skeleton className="h-64" />
    </div>
  );
}
