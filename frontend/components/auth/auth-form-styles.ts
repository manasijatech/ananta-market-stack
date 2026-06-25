export const authFormInputClassName =
    "h-10 rounded-lg border-border/80 bg-background/50 px-3.5 text-sm shadow-none placeholder:text-muted-foreground/90 focus-visible:border-primary focus-visible:ring-[3px] focus-visible:ring-[var(--accent-glow)] dark:bg-[var(--bg-elevated)]/50";

export const authFormInputGroupClassName =
    "h-10 rounded-lg border-border/80 bg-background/50 shadow-none has-[[data-slot=input-group-control]:focus-visible]:border-primary has-[[data-slot=input-group-control]:focus-visible]:ring-[3px] has-[[data-slot=input-group-control]:focus-visible]:ring-[var(--accent-glow)] dark:bg-[var(--bg-elevated)]/50";

export const authFormCardClassName =
    "gap-0 overflow-hidden rounded-xl border-border bg-[var(--bg-elevated)] py-0 shadow-[0_18px_48px_-28px_rgba(0,0,0,0.65)]";

export const authFormPrimaryButtonClassName =
    "h-10 w-full rounded-lg bg-primary text-sm font-semibold text-primary-foreground shadow-md shadow-primary/25 transition-all duration-200 hover:-translate-y-px hover:bg-[color-mix(in_srgb,var(--accent)_92%,white)] hover:shadow-lg hover:shadow-primary/30 active:translate-y-0 active:shadow-md";

export type PasswordChecks = {
    length: boolean;
    number: boolean;
    uppercase: boolean;
};

export function getPasswordChecks(password: string): PasswordChecks {
    return {
        length: password.length >= 8,
        number: /\d/.test(password),
        uppercase: /[A-Z]/.test(password)
    };
}

export function getPasswordStrength(checks: PasswordChecks): {
    label: string;
    percent: number;
    tone: string;
} {
    const score = [checks.length, checks.number, checks.uppercase].filter(Boolean).length;

    if (score === 0) {
        return { label: "Enter a password", percent: 0, tone: "bg-border" };
    }

    if (score === 1) {
        return { label: "Weak", percent: 33, tone: "bg-destructive/80" };
    }

    if (score === 2) {
        return { label: "Fair", percent: 66, tone: "bg-primary/70" };
    }

    return { label: "Strong", percent: 100, tone: "bg-primary" };
}
