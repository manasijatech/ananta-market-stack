import {
	HeaderSkeleton,
	LoadingShell,
} from "@/components/ui/loading-skeletons";
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
			<div className="mb-4 rounded-lg border border-border">
				<div className="flex items-start justify-between gap-4 border-b border-border px-6 py-4">
					<div className="grid gap-2">
						<Skeleton className="h-4 w-28" />
						<Skeleton className="h-3 w-64 max-w-full" />
					</div>
					<Skeleton className="size-8" />
				</div>
				<div className="grid gap-3 p-4">
					<div className="flex flex-col gap-3 min-[960px]:flex-row min-[960px]:items-center min-[960px]:justify-between">
						<div className="flex flex-wrap gap-1">
							{Array.from({ length: 5 }).map((_, index) => (
								<Skeleton className="h-8 w-24" key={index} />
							))}
						</div>
						<div className="flex w-full gap-2 min-[960px]:max-w-xl">
							<Skeleton className="h-9 min-w-0 flex-1" />
							<Skeleton className="h-9 w-28" />
						</div>
					</div>
				</div>
			</div>

			<div className="rounded-lg border border-border">
				<div className="flex items-start justify-between gap-4 border-b border-border px-6 py-4">
					<div className="grid gap-2">
						<Skeleton className="h-4 w-20" />
						<Skeleton className="h-3 w-72 max-w-full" />
					</div>
					<Skeleton className="h-4 w-12" />
				</div>
				<div className="grid gap-4 p-4">
					<div className="flex flex-col gap-2 min-[760px]:flex-row min-[760px]:items-center min-[760px]:justify-between">
						<Skeleton className="h-9 w-56" />
						<Skeleton className="h-9 w-full min-[760px]:max-w-md min-[760px]:flex-1" />
					</div>
					{Array.from({ length: 4 }).map((_, index) => (
						<div className="rounded-lg border border-border p-3" key={index}>
							<div className="flex gap-3">
								<Skeleton className="size-7 rounded-full" />
								<div className="min-w-0 flex-1 grid gap-2">
									<Skeleton className="h-4 w-40" />
									<Skeleton className="h-5 w-full max-w-xl" />
									<Skeleton className="h-4 w-full max-w-3xl" />
								</div>
							</div>
						</div>
					))}
				</div>
			</div>
		</LoadingShell>
	);
}

export function MarketIntelligenceResultLoading() {
	return (
		<div className="grid gap-2">
			{Array.from({ length: 4 }).map((_, index) => (
				<div className="rounded-lg border border-border p-3" key={index}>
					<div className="flex gap-3">
						<Skeleton className="size-7 rounded-full" />
						<div className="min-w-0 flex-1 grid gap-2">
							<Skeleton className="h-4 w-40" />
							<Skeleton className="h-5 w-full max-w-xl" />
							<Skeleton className="h-4 w-full max-w-3xl" />
						</div>
					</div>
				</div>
			))}
		</div>
	);
}
