import Link from "next/link";
import { BrandLogo } from "@/components/brand-logo";
import { ThemeToggle } from "@/components/theme-toggle";
import { cn } from "@/lib/utils";

type AuthShellProps = {
	children: React.ReactNode;
	size?: "default" | "wide";
};

export function AuthShell({ children, size = "default" }: AuthShellProps) {
	return (
		<main className="app-page-background relative flex min-h-svh flex-col items-center justify-center p-6 md:p-10">
			<div className="absolute right-5 top-5 z-10">
				<ThemeToggle />
			</div>

			<div
				className={cn(
					"flex w-full flex-col",
					size === "wide" ? "max-w-[480px] gap-5" : "max-w-sm gap-6",
				)}
			>
				<Link href="/" className="flex self-center font-medium">
					<BrandLogo imageClassName="text-sm" />
				</Link>

				{children}
			</div>
		</main>
	);
}
