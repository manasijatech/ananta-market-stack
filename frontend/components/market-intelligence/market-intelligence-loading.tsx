import { HeaderSkeleton, LoadingShell } from "@/components/ui/loading-skeletons";
import { Skeleton } from "@/components/ui/skeleton";

export function MarketIntelligenceLoading() {
 return (
 <LoadingShell
 header={
 <HeaderSkeleton
 eyebrowWidth="w-36"
 titleWidth="w-40"
 descriptionWidth="w-full max-w-lg"
 />
 }
 >
 <nav className="mb-7 flex flex-wrap gap-2" aria-label="Loading market intelligence sections">
 {Array.from({ length: 6 }).map((_, index) => (
 <Skeleton className="h-8 w-24" key={index} />
 ))}
 </nav>

 <section className="mb-7 border-y border-border py-5">
 <Skeleton className="h-3 w-40" />
 <Skeleton className="mt-2 h-4 w-64" />
 <div className="mt-4 flex flex-col gap-2 border-l-2 border-border pl-3 min-[760px]:flex-row min-[760px]:items-center">
 <div className="min-[760px]:w-40">
 <Skeleton className="h-5 w-24" />
 <Skeleton className="mt-1 h-3 w-16" />
 </div>
 <div className="flex flex-wrap gap-x-5 gap-y-3">
 {Array.from({ length: 3 }).map((_, index) => (
 <div className="flex items-center gap-2.5" key={index}>
 <Skeleton className="size-8" />
 <div>
 <Skeleton className="h-4 w-36" />
 <Skeleton className="mt-1 h-3 w-16" />
 </div>
 </div>
 ))}
 </div>
 </div>
 </section>

 <div className="grid gap-4">
 {Array.from({ length: 4 }).map((_, index) => (
 <div className="border-l-2 border-border pl-4" key={index}>
 <Skeleton className="h-5 w-full max-w-xl" />
 <Skeleton className="mt-2 h-3 w-72" />
 <Skeleton className="mt-3 h-4 w-full max-w-3xl" />
 </div>
 ))}
 </div>
 </LoadingShell>
 );
}
