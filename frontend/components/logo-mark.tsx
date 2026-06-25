import Image from "next/image";
import { cn } from "@/lib/utils";

type LogoMarkProps = {
	className?: string;
};

export function LogoMark({ className }: LogoMarkProps) {
	return (
		<Image
			src="/logo-mark.svg"
			alt=""
			width={50}
			height={50}
			className={cn(
				"h-[var(--logo-mark-height,1em)] w-auto shrink-0",
				className,
			)}
			aria-hidden
		/>
	);
}
