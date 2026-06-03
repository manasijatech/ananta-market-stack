import * as React from "react";
import * as SelectPrimitive from "@radix-ui/react-select";
import { Check, ChevronDown, ChevronUp } from "lucide-react";
import { cn } from "@/lib/utils";

function Select({ className, ...props }: React.ComponentProps<"select">) {
    return (
        <select
            data-slot="select"
            className={cn(
                "border-input bg-background text-foreground focus-visible:border-ring h-10 w-full rounded-md border px-3 text-[15px] leading-5 outline-none disabled:cursor-not-allowed disabled:opacity-40",
                className
            )}
            {...props}
        />
    );
}

const SelectRoot = SelectPrimitive.Root;
const SelectGroup = SelectPrimitive.Group;
const SelectValue = SelectPrimitive.Value;

function SelectTrigger({
    className,
    children,
    ...props
}: React.ComponentPropsWithoutRef<typeof SelectPrimitive.Trigger>) {
    return (
        <SelectPrimitive.Trigger
            className={cn(
                "flex h-10 w-full items-center justify-between gap-2 border border-input bg-background px-3 text-sm text-foreground outline-none transition-colors focus-visible:border-ring disabled:cursor-not-allowed disabled:opacity-40 [&>span]:min-w-0 [&>span]:truncate",
                className
            )}
            {...props}
        >
            {children}
            <SelectPrimitive.Icon asChild>
                <ChevronDown className="size-4 shrink-0 text-muted-foreground" />
            </SelectPrimitive.Icon>
        </SelectPrimitive.Trigger>
    );
}

function SelectScrollUpButton({
    className,
    ...props
}: React.ComponentPropsWithoutRef<typeof SelectPrimitive.ScrollUpButton>) {
    return (
        <SelectPrimitive.ScrollUpButton
            className={cn("flex cursor-default items-center justify-center py-1", className)}
            {...props}
        >
            <ChevronUp className="size-4" />
        </SelectPrimitive.ScrollUpButton>
    );
}

function SelectScrollDownButton({
    className,
    ...props
}: React.ComponentPropsWithoutRef<typeof SelectPrimitive.ScrollDownButton>) {
    return (
        <SelectPrimitive.ScrollDownButton
            className={cn("flex cursor-default items-center justify-center py-1", className)}
            {...props}
        >
            <ChevronDown className="size-4" />
        </SelectPrimitive.ScrollDownButton>
    );
}

function SelectContent({
    className,
    children,
    position = "popper",
    ...props
}: React.ComponentPropsWithoutRef<typeof SelectPrimitive.Content>) {
    return (
        <SelectPrimitive.Portal>
            <SelectPrimitive.Content
                className={cn(
                    "relative z-[90] max-h-80 min-w-[8rem] overflow-hidden border border-border bg-popover text-popover-foreground shadow-xl data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0",
                    position === "popper" &&
                        "data-[side=bottom]:translate-y-1 data-[side=left]:-translate-x-1 data-[side=right]:translate-x-1 data-[side=top]:-translate-y-1",
                    className
                )}
                position={position}
                {...props}
            >
                <SelectScrollUpButton />
                <SelectPrimitive.Viewport
                    className={cn(
                        "p-1",
                        position === "popper" &&
                            "w-full min-w-[var(--radix-select-trigger-width)]"
                    )}
                >
                    {children}
                </SelectPrimitive.Viewport>
                <SelectScrollDownButton />
            </SelectPrimitive.Content>
        </SelectPrimitive.Portal>
    );
}

function SelectLabel({ className, ...props }: React.ComponentPropsWithoutRef<typeof SelectPrimitive.Label>) {
    return (
        <SelectPrimitive.Label
            className={cn(
                "px-2 py-1.5 text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground",
                className
            )}
            {...props}
        />
    );
}

function SelectItem({ className, children, ...props }: React.ComponentPropsWithoutRef<typeof SelectPrimitive.Item>) {
    return (
        <SelectPrimitive.Item
            className={cn(
                "group relative flex h-8 cursor-default select-none items-center gap-2 px-2 py-1.5 pr-8 text-sm outline-none data-[disabled]:pointer-events-none data-[highlighted]:bg-primary data-[highlighted]:text-primary-foreground data-[disabled]:opacity-40",
                className
            )}
            {...props}
        >
            <span className="absolute right-2 flex size-4 items-center justify-center">
                <SelectPrimitive.ItemIndicator>
                    <Check className="size-4" />
                </SelectPrimitive.ItemIndicator>
            </span>
            <SelectPrimitive.ItemText>{children}</SelectPrimitive.ItemText>
        </SelectPrimitive.Item>
    );
}

function SelectSeparator({ className, ...props }: React.ComponentPropsWithoutRef<typeof SelectPrimitive.Separator>) {
    return <SelectPrimitive.Separator className={cn("-mx-1 my-1 h-px bg-border", className)} {...props} />;
}

export {
    Select,
    SelectContent,
    SelectGroup,
    SelectItem,
    SelectLabel,
    SelectRoot,
    SelectScrollDownButton,
    SelectScrollUpButton,
    SelectSeparator,
    SelectTrigger,
    SelectValue
};
