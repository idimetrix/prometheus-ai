import { Skeleton } from "@prometheus/ui";

export default function AboutLoading() {
  return (
    <div className="mx-auto max-w-4xl space-y-8 px-4 py-16">
      <div className="text-center">
        <Skeleton className="mx-auto h-10 w-48" />
        <Skeleton className="mx-auto mt-4 h-5 w-96" />
      </div>
      <div className="space-y-6">
        <Skeleton className="h-32" />
        <Skeleton className="h-32" />
        <Skeleton className="h-32" />
      </div>
    </div>
  );
}
