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
                className={cn("h-10 w-64 shrink-0 object-contain", imageClassName)}
                src="/brand/ananta-market-stack-logo-transparent.png"
            />
        </span>
    );
}
