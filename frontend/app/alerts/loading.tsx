import {
  AlertsNavSkeleton,
  FeedSkeleton,
  HeaderSkeleton,
  LoadingShell,
  StatGridSkeleton
} from "@/components/ui/loading-skeletons";

export default function AlertsOverviewLoading() {
  return (
    <LoadingShell header={<HeaderSkeleton action titleWidth="w-96" />}>
      <AlertsNavSkeleton />
      <StatGridSkeleton />
      <div className="mb-8 flex flex-wrap gap-3">
        {Array.from({ length: 4 }).map((_, index) => (
          <div className="h-9 w-40 animate-pulse bg-[var(--bg-elevated)]" key={index} />
        ))}
      </div>
      <FeedSkeleton rows={6} />
    </LoadingShell>
  );
}
