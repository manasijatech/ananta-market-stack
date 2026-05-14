import { CardGridSkeleton } from "@/components/ui/loading-skeletons";

export default function AlertTemplatesLoading() {
  return <CardGridSkeleton count={4} columns="min-[960px]:grid-cols-2" />;
}
