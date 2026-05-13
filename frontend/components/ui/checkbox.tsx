"use client";

import * as React from "react";
import * as CheckboxPrimitive from "@radix-ui/react-checkbox";
import { CheckIcon } from "lucide-react";
import { cn } from "@/lib/utils";

function Checkbox({ className, ...props }: React.ComponentProps<typeof CheckboxPrimitive.Root>) {
 return (
 <CheckboxPrimitive.Root
 data-slot="checkbox"
 className={cn(
 "peer border-input bg-transparent data-[state=checked]:bg-primary data-[state=checked]:text-primary-foreground data-[state=checked]:border-primary focus-visible:border-ring focus-visible:ring-0 size-4 shrink-0 cursor-pointer border outline-none disabled:cursor-not-allowed disabled:opacity-40",
 className
 )}
 {...props}
 >
 <CheckboxPrimitive.Indicator data-slot="checkbox-indicator" className="flex items-center justify-center text-current">
 <CheckIcon className="size-3.5" />
 </CheckboxPrimitive.Indicator>
 </CheckboxPrimitive.Root>
 );
}

export { Checkbox };
