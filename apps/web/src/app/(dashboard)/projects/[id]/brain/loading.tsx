import { Skeleton } from "@prometheus/ui";

export default function BrainRedirectLoading() {
  return (
    <div className="flex min-h-[60vh] items-center justify-center">
      <Skeleton className="h-8 w-48" />
    </div>
  );
}
