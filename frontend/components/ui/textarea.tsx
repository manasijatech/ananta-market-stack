import * as React from "react";
import { cn } from "@/lib/utils";

const Textarea = React.forwardRef<HTMLTextAreaElement, React.ComponentProps<"textarea">>(
 ({ className, ...props }, ref) => {
  return (
  <textarea
  data-slot="textarea"
  ref={ref}
  className={cn(
  "border-input bg-background text-foreground placeholder:text-muted-foreground focus-visible:border-ring min-h-24 w-full rounded-md border px-3 py-2 text-sm outline-none disabled:cursor-not-allowed disabled:opacity-40",
  className
  )}
  {...props}
  />
  );
 }
);

Textarea.displayName = "Textarea";

export { Textarea };
