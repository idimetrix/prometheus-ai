/** Reusable skeleton loading components for consistent loading states. */

interface SkeletonProps {
  className?: string;
}

/** Base skeleton pulse element */
export function Skeleton({ className = "" }: SkeletonProps) {
  return (
    <div className={`animate-pulse rounded-md bg-zinc-800 ${className}`} />
  );
}

/** Single line of text */
export function SkeletonLine({ className = "" }: SkeletonProps) {
  return <Skeleton className={`h-4 w-full ${className}`} />;
}

/** Short text line (for labels, titles) */
export function SkeletonShortLine({ className = "" }: SkeletonProps) {
  return <Skeleton className={`h-4 w-32 ${className}`} />;
}

/** Card skeleton with title, description, and footer */
export function SkeletonCard({ className = "" }: SkeletonProps) {
  return (
    <div
      className={`rounded-xl border border-zinc-800 bg-zinc-900/50 p-5 ${className}`}
    >
      <div className="flex items-center gap-3">
        <Skeleton className="h-8 w-8 rounded-lg" />
        <Skeleton className="h-4 w-24" />
      </div>
      <Skeleton className="mt-4 h-8 w-20" />
      <Skeleton className="mt-2 h-3 w-32" />
    </div>
  );
}

/** Table row skeleton */
export function SkeletonTableRow({
  columns = 4,
  className = "",
}: SkeletonProps & { columns?: number }) {
  return (
    <tr className={className}>
      {Array.from({ length: columns }).map((_, i) => (
        <td className="px-4 py-3" key={`col-${i}`}>
          <Skeleton
            className={`h-4 ${(() => {
              if (i === 0) {
                return "w-32";
              }
              if (i === columns - 1) {
                return "w-16";
              }
              return "w-20";
            })()}`}
          />
        </td>
      ))}
    </tr>
  );
}

/** Full table skeleton with header and rows */
export function SkeletonTable({
  rows = 5,
  columns = 4,
  className = "",
}: SkeletonProps & { rows?: number; columns?: number }) {
  return (
    <div
      className={`rounded-xl border border-zinc-800 bg-zinc-900/50 ${className}`}
    >
      <table className="w-full">
        <thead>
          <tr className="border-zinc-800 border-b">
            {Array.from({ length: columns }).map((_, i) => (
              <th className="px-4 py-3" key={`th-${i}`}>
                <Skeleton className="h-3 w-16" />
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-zinc-800">
          {Array.from({ length: rows }).map((_, i) => (
            <SkeletonTableRow columns={columns} key={`row-${i}`} />
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Stat card grid skeleton (4 columns) */
export function SkeletonStats({ count = 4 }: { count?: number }) {
  return (
    <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
      {Array.from({ length: count }).map((_, i) => (
        <SkeletonCard key={`stat-${i}`} />
      ))}
    </div>
  );
}

/** Page header skeleton */
export function SkeletonPageHeader({ className = "" }: SkeletonProps) {
  return (
    <div className={`space-y-2 ${className}`}>
      <Skeleton className="h-8 w-48" />
      <Skeleton className="h-4 w-72" />
    </div>
  );
}

/** Avatar / circular skeleton */
export function SkeletonAvatar({
  size = "md",
  className = "",
}: SkeletonProps & { size?: "sm" | "md" | "lg" }) {
  const sizeMap = { sm: "h-6 w-6", md: "h-10 w-10", lg: "h-14 w-14" };
  return <Skeleton className={`rounded-full ${sizeMap[size]} ${className}`} />;
}

/** Full page loading skeleton for dashboard pages */
export function SkeletonDashboardPage() {
  return (
    <div className="space-y-8">
      <SkeletonPageHeader />
      <SkeletonStats />
      <div className="space-y-4">
        <Skeleton className="h-6 w-40" />
        <SkeletonTable columns={4} rows={5} />
      </div>
    </div>
  );
}
