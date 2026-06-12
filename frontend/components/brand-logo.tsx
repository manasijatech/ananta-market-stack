import { cn } from "@/lib/utils";

type BrandLogoProps = {
    className?: string;
    imageClassName?: string;
};

export function BrandLogo({ className, imageClassName }: BrandLogoProps) {
    return (
        <span className={cn("inline-flex min-w-0 items-center", className)}>
            <span
                aria-label="Ananta Market Stack"
                className={cn(
                    "inline-flex items-baseline gap-[0.04em] whitespace-nowrap py-[0.36rem] font-['IBM_Plex_Sans',ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,'Segoe_UI',sans-serif] text-[1.5rem] leading-none font-semibold tracking-[-0.05em] lowercase text-foreground",
                    imageClassName
                )}
            >
                <span>ananta</span>
                <span aria-hidden="true" className="text-primary">
                    /
                </span>
            </span>
        </span>
    );
}
