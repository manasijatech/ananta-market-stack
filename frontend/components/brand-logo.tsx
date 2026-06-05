import { cn } from "@/lib/utils";

type BrandLogoProps = {
    className?: string;
    imageClassName?: string;
};

export function BrandLogo({ className, imageClassName }: BrandLogoProps) {
    return (
        <span className={cn("inline-flex items-center", className)}>
            <img
                alt="Ananta Market Stack"
                className={cn("h-10 w-64 shrink-0 object-contain dark:hidden", imageClassName)}
                src="/brand/ananta-market-stack-logo-light-transparent.png"
            />
            <img
                alt="Ananta Market Stack"
                className={cn("hidden h-10 w-64 shrink-0 object-contain dark:block", imageClassName)}
                src="/brand/ananta-market-stack-logo-dark-transparent.png"
            />
        </span>
    );
}
