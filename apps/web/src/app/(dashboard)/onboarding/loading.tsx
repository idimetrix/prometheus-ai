import { Skeleton } from "@prometheus/ui";

export default function OnboardingLoading() {
  return (
    <div className="flex min-h-[80vh] items-center justify-center">
      <div className="w-full max-w-lg space-y-6">
        <div className="text-center">
          <Skeleton className="mx-auto h-8 w-56" />
          <Skeleton className="mx-auto mt-2 h-4 w-72" />
        </div>
        <Skeleton className="h-2 w-full" />
        <Skeleton className="h-64 w-full" />
        <div className="flex justify-end gap-3">
          <Skeleton className="h-9 w-20" />
          <Skeleton className="h-9 w-24" />
        </div>
      </div>
    </div>
  );
}
