import { cn } from "@/lib/utils";

type BrandLogoProps = {
 className?: string;
 imageClassName?: string;
};

export function BrandLogo({ className, imageClassName }: BrandLogoProps) {
 return (
  <span className={cn("inline-flex items-center", className)}>
   <img
    alt="Market Stack"
    className={cn("h-10 w-48 shrink-0 object-contain", imageClassName)}
    src="/brand/market-stack-logo-transparent.png"
   />
  </span>
 );
}
