import Link from "next/link";
import { BrandLogo } from "@/components/brand-logo";
import { ThemeToggle } from "@/components/theme-toggle";

type AuthShellProps = {
	children: React.ReactNode;
};

export function AuthShell({ children }: AuthShellProps) {
	return (
		<main className="relative flex min-h-svh flex-col items-center justify-center gap-6 bg-muted p-6 md:p-10">
			<div className="absolute right-5 top-5 z-10">
				<ThemeToggle />
			</div>

			<div className="flex w-full max-w-sm flex-col gap-6">
				<Link
					href="/"
					className="flex items-center gap-2 self-center font-medium"
				>
					<div className="flex size-6 items-center justify-center rounded-md bg-primary text-sm font-bold text-primary-foreground">
						/
					</div>
					<BrandLogo imageClassName="text-base" />
				</Link>

				{children}
			</div>
		</main>
	);
}
