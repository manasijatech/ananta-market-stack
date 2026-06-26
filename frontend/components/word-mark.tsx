import Image from "next/image";
import { cn } from "@/lib/utils";

type WordMarkProps = {
    className?: string;
};

export function WordMark({ className }: WordMarkProps) {
    return (
        <Image
            src="/word-mark.svg"
            alt=""
            width={77}
            height={18}
            className={cn("h-[var(--word-mark-height,1em)] w-auto shrink-0 dark:invert", className)}
            aria-hidden
        />
    );
}
