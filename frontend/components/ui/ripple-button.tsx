"use client";

import * as React from "react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

type Ripple = {
    id: number;
    size: number;
    x: number;
    y: number;
};

type RippleButtonProps = React.ComponentProps<typeof Button>;

export function RippleButton({ children, className, disabled, onKeyDown, onPointerDown, ...props }: RippleButtonProps) {
    const buttonRef = React.useRef<HTMLButtonElement>(null);
    const rippleId = React.useRef(0);
    const [ripples, setRipples] = React.useState<Ripple[]>([]);

    const addRipple = React.useCallback(
        (clientX?: number, clientY?: number) => {
            if (disabled || window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
                return;
            }

            const button = buttonRef.current;
            if (!button) {
                return;
            }

            const rect = button.getBoundingClientRect();
            const originX = typeof clientX === "number" ? clientX - rect.left : rect.width / 2;
            const originY = typeof clientY === "number" ? clientY - rect.top : rect.height / 2;
            const radius = Math.hypot(
                Math.max(originX, rect.width - originX),
                Math.max(originY, rect.height - originY)
            );
            const size = radius * 2;
            const id = rippleId.current;
            rippleId.current += 1;

            setRipples((current) => [...current, { id, size, x: originX - radius, y: originY - radius }]);
            window.setTimeout(() => {
                setRipples((current) => current.filter((ripple) => ripple.id !== id));
            }, 650);
        },
        [disabled]
    );

    return (
        <Button
            ref={buttonRef}
            className={cn("relative isolate overflow-hidden", className)}
            disabled={disabled}
            onKeyDown={(event) => {
                onKeyDown?.(event);
                if (!event.defaultPrevented && !event.repeat && (event.key === "Enter" || event.key === " ")) {
                    addRipple();
                }
            }}
            onPointerDown={(event) => {
                onPointerDown?.(event);
                if (!event.defaultPrevented) {
                    addRipple(event.clientX, event.clientY);
                }
            }}
            {...props}
        >
            <span className="relative z-10">{children}</span>
            <span aria-hidden="true" className="pointer-events-none absolute inset-0 z-0">
                {ripples.map((ripple) => (
                    <span
                        className="ripple-button__wave"
                        key={ripple.id}
                        style={{
                            height: ripple.size,
                            left: ripple.x,
                            top: ripple.y,
                            width: ripple.size
                        }}
                    />
                ))}
            </span>
        </Button>
    );
}
