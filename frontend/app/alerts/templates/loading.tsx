import { AlertsNavSkeleton, CardGridSkeleton, HeaderSkeleton, LoadingShell } from "@/components/ui/loading-skeletons";

export default function AlertTemplatesLoading() {
  return (
    <LoadingShell header={<HeaderSkeleton titleWidth="w-72" />}>
      <AlertsNavSkeleton />
      <CardGridSkeleton count={4} columns="min-[960px]:grid-cols-2" />
    </LoadingShell>
  );
}
