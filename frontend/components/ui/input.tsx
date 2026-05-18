import * as React from "react";
import { cn } from "@/lib/utils";

const Input = React.forwardRef<HTMLInputElement, React.ComponentProps<"input">>(
 ({ className, type, ...props }, ref) => {
  return (
  <input
  data-slot="input"
  ref={ref}
  type={type}
  className={cn(
  "border-input bg-background placeholder:text-muted-foreground flex h-10 w-full min-w-0 rounded-md border px-3 py-2 text-[15px] leading-5 shadow-xs transition-colors duration-100 ease-out outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-40 aria-invalid:border-destructive aria-invalid:ring-destructive/20",
  className
  )}
  {...props}
  />
  );
 }
);

Input.displayName = "Input";

export { Input };
