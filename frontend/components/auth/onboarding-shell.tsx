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
		<main className="relative min-h-svh bg-background">
			<div className="absolute right-5 top-5 z-10">
				<ThemeToggle />
			</div>

			<div className="mx-auto flex min-h-svh w-full max-w-6xl items-center px-5 py-8 sm:px-8 lg:px-12 lg:py-10">
				<div className="grid w-full items-center gap-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,480px)] lg:gap-16 xl:gap-20">
					<aside className="hidden flex-col justify-center gap-10 lg:flex">
						<div className="space-y-4">
							<Link href="/" className="inline-flex font-medium">
								<BrandLogo imageClassName="text-xl" />
							</Link>
							<div className="space-y-2">
								<h1 className="text-3xl font-semibold tracking-tight text-foreground">
									Create your administrator account
								</h1>
								<p className="max-w-md text-base leading-relaxed text-muted-foreground">
									Set up the first workspace admin to unlock broker connections,
									alerts, and shared configuration.
								</p>
							</div>
						</div>

						<ul className="space-y-4">
							{setupFeatures.map(({ icon: Icon, label, description }) => (
								<li key={label} className="flex gap-3">
									<div className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-lg border border-border bg-[var(--bg-elevated)] text-primary">
										<Icon className="size-4.5" stroke={1.75} />
									</div>
									<div className="space-y-1">
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

						<div className="flex items-start gap-3 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-elevated)]/60 p-4">
							<div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
								<IconLock className="size-4.5" stroke={1.75} />
							</div>
							<div className="space-y-1">
								<p className="text-sm font-medium text-foreground">
									Secure setup
								</p>
								<p className="text-sm leading-relaxed text-muted-foreground">
									Your password is encrypted and never stored in plain text.
								</p>
							</div>
						</div>
					</aside>

					<div className="mx-auto flex w-full max-w-[480px] flex-col gap-6 lg:mx-0 lg:max-w-none">
						<div className="space-y-2 text-center lg:hidden">
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
