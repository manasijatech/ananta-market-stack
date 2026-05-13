import { Skeleton } from "@/components/ui/skeleton";

export function AuthLoading({ mode = "sign-in" }: { mode?: "sign-in" | "sign-up" }) {
 return (
 <main className="grid min-h-screen grid-cols-1 lg:grid-cols-[minmax(0,1fr)_minmax(420px,520px)]">
 <section className="relative isolate grid min-h-[360px] content-between overflow-hidden border-b border-border bg-background p-7 text-foreground lg:min-h-screen lg:border-b-0 lg:border-r lg:p-12">
 <div className="absolute inset-x-0 top-0 z-10 h-[3px] bg-primary" />
 <div className="flex items-center gap-3">
 <Skeleton className="size-10" />
 <Skeleton className="h-4 w-36" />
 </div>
 <div className="max-w-[720px]">
 <Skeleton className="mb-4 h-3 w-32" />
 <Skeleton className="h-16 w-full max-w-[640px]" />
 <Skeleton className="mt-3 h-16 w-full max-w-[560px]" />
 </div>
 </section>

 <section className="flex items-center justify-center bg-card p-0 min-[560px]:p-6 lg:p-8">
 <div className="absolute right-5 top-5 z-10">
 <Skeleton className="size-9" />
 </div>
 <div className="w-full max-w-[430px] border-y border-border px-6 py-7">
 <div className="pb-6">
 <Skeleton className="mb-3 h-3 w-28" />
 <Skeleton className="h-10 w-44" />
 <Skeleton className="mt-3 h-4 w-72" />
 </div>
 <div className="grid gap-5">
 {mode === "sign-up" ? (
 <div>
 <Skeleton className="mb-2 h-4 w-16" />
 <Skeleton className="h-12 w-full" />
 </div>
 ) : null}
 <div>
 <Skeleton className="mb-2 h-4 w-16" />
 <Skeleton className="h-12 w-full" />
 </div>
 <div>
 <Skeleton className="mb-2 h-4 w-20" />
 <Skeleton className="h-12 w-full" />
 </div>
 {mode === "sign-in" ? <Skeleton className="h-5 w-40" /> : null}
 <Skeleton className="h-12 w-full" />
 </div>
 <Skeleton className="mx-auto mt-6 h-4 w-48" />
 </div>
 </section>
 </main>
 );
}
