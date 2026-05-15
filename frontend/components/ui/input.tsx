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
  "border-input bg-transparent placeholder:text-muted-foreground flex h-10 w-full min-w-0 border-0 border-b px-0 py-1 text-sm transition-colors duration-100 ease-out outline-none focus-visible:border-ring focus-visible:ring-0 disabled:cursor-not-allowed disabled:opacity-40 aria-invalid:border-destructive",
  className
  )}
  {...props}
  />
  );
 }
);

Input.displayName = "Input";

export { Input };
