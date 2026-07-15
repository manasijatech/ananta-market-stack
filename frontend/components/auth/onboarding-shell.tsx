import Link from "next/link";
import { BrandLogo } from "@/components/brand-logo";
import { ThemeToggle } from "@/components/theme-toggle";
import { IconLock, IconPlugConnected, IconSettings } from "@tabler/icons-react";

type OnboardingShellProps = {
	children: React.ReactNode;
};

const setupFeatures = [
	{
		icon: IconLock,
		label: "Secure",
		description: "Encrypted credentials and session-backed authentication.",
	},
	{
		icon: IconPlugConnected,
		label: "Broker management",
		description:
			"Connect and manage multiple broker accounts from one workspace.",
	},
	{
		icon: IconSettings,
		label: "Workspace settings",
		description: "Configure shared API keys, alerts, and team access.",
	},
] as const;

export function OnboardingShell({ children }: OnboardingShellProps) {
	return (
		<main className="app-page-background relative isolate flex min-h-svh items-center justify-center overflow-hidden p-0 md:p-6">
			<div className="absolute right-4 top-[max(1.25rem,env(safe-area-inset-top))] z-10 sm:right-5">
				<ThemeToggle />
			</div>

			<div className="mx-auto flex min-h-svh w-full max-w-6xl items-center px-5 py-8 sm:px-8 md:min-h-[calc(100svh-3rem)] lg:px-12 lg:py-10">
				<div className="grid w-full items-center gap-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,480px)] lg:gap-16 xl:gap-20">
					<aside className="hidden flex-col justify-center gap-10 lg:flex">
						<div className="flex flex-col gap-4">
							<Link href="/" className="inline-flex font-medium">
								<BrandLogo imageClassName="text-xl" />
							</Link>
							<div className="flex flex-col gap-2">
								<h1 className="text-3xl font-heading font-bold tracking-tight text-foreground">
									Create your administrator account
								</h1>
								<p className="max-w-md text-base leading-relaxed text-muted-foreground">
									Set up the first workspace admin to unlock broker connections,
									alerts, and shared configuration.
								</p>
							</div>
						</div>

						<ul className="flex flex-col gap-4">
							{setupFeatures.map(({ icon: Icon, label, description }) => (
								<li key={label} className="flex gap-3">
									<div className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-lg border border-primary/45 bg-primary/20 text-primary-foreground shadow-sm dark:border-primary/25 dark:bg-primary/10 dark:text-primary">
										<Icon className="size-4.5" stroke={1.75} aria-hidden="true" />
									</div>
									<div className="flex flex-col gap-1">
										<p className="text-sm font-medium text-foreground">
											{label}
										</p>
										<p className="text-sm leading-relaxed text-muted-foreground">
											{description}
										</p>
									</div>
								</li>
							))}
						</ul>
					</aside>

					<div className="mx-auto flex w-full max-w-[480px] flex-col gap-6 lg:mx-0 lg:max-w-none">
						<div className="flex flex-col gap-2 text-center lg:hidden">
							<Link href="/" className="inline-flex justify-center font-medium">
								<BrandLogo imageClassName="text-base" />
							</Link>
							<p className="text-sm text-muted-foreground">
								Create your administrator account
							</p>
						</div>

						{children}
					</div>
				</div>
			</div>
		</main>
	);
}
