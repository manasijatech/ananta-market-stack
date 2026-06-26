import { LogoMark } from "@/components/logo-mark";
import { WordMark } from "@/components/word-mark";
import { cn } from "@/lib/utils";

type BrandLogoProps = {
    className?: string;
    imageClassName?: string;
    markClassName?: string;
    showMark?: boolean;
    /** Hides the wordmark for narrow headers (mobile toolbar). */
    compact?: boolean;
};

export function BrandLogo({
    className,
    imageClassName,
    markClassName,
    showMark = true,
    compact = false
}: BrandLogoProps) {
    return (
        <span
            role="img"
            aria-label="Ananta Market Stack"
            className={cn(
                "inline-flex min-w-0 items-center gap-[0.4em] text-[1.25rem] [--logo-mark-height:1.3em] [--word-mark-height:1em]",
                imageClassName,
                className
            )}
        >
            {showMark ? <LogoMark className={markClassName} /> : null}
            {!compact ? <WordMark /> : null}
        </span>
    );
}
