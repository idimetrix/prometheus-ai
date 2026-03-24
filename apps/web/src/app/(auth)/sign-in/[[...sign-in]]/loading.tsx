import { Skeleton } from "@prometheus/ui";

export default function SignInLoading() {
  return (
    <div className="flex min-h-screen items-center justify-center">
      <Skeleton className="h-96 w-96 rounded-xl" />
    </div>
  );
}
