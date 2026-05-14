import { TableSkeleton } from "@/components/ui/loading-skeletons";
import { Skeleton } from "@/components/ui/skeleton";

export default function AlertSubscriptionsLoading() {
  return (
    <>
      <section className="mb-6 border border-border p-5">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <Skeleton className="h-5 w-44" />
            <Skeleton className="mt-2 h-3 w-80" />
          </div>
          <Skeleton className="h-10 w-36" />
        </div>
        <div className="mt-5 grid gap-3 min-[760px]:grid-cols-[1fr_9rem]">
          <Skeleton className="h-11" />
          <Skeleton className="h-11" />
        </div>
      </section>
      <TableSkeleton columns={5} rows={6} />
    </>
  );
}
