import {
  FeedSkeleton,
  StatGridSkeleton
} from "@/components/ui/loading-skeletons";

export default function AlertsOverviewLoading() {
  return (
    <>
      <StatGridSkeleton />
      <div className="mb-8 flex flex-wrap gap-3">
        {Array.from({ length: 4 }).map((_, index) => (
          <div className="h-9 w-40 animate-pulse bg-[var(--bg-elevated)]" key={index} />
        ))}
      </div>
      <FeedSkeleton rows={6} />
    </>
  );
}
