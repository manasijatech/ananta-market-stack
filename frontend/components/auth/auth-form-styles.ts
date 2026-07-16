const authFormInputInnerClassName =
    "[&_[data-slot=input]]:h-full [&_[data-slot=input]]:min-h-0 [&_[data-slot=input]]:flex-1 [&_[data-slot=input]]:border-0 [&_[data-slot=input]]:bg-transparent [&_[data-slot=input]]:px-0 [&_[data-slot=input]]:py-0 [&_[data-slot=input]]:leading-normal [&_[data-slot=input]]:shadow-none [&_[data-slot=input]]:ring-0 sm:[&_[data-slot=input]]:h-full sm:[&_[data-slot=input]]:leading-normal";

export const authFormInputClassName =
    `inline-flex h-10 items-center rounded-lg border border-border/80 bg-background px-3.5 text-sm shadow-none before:!hidden has-aria-invalid:!ring-0 has-aria-invalid:!shadow-none dark:has-aria-invalid:!ring-0 has-focus-visible:has-aria-invalid:!ring-0 placeholder:text-muted-foreground/90 has-[input:focus-visible]:border-primary has-[input:focus-visible]:ring-[3px] has-[input:focus-visible]:ring-[var(--accent-glow)] has-[:disabled,:focus-visible,[aria-invalid]]:!shadow-none dark:bg-background ${authFormInputInnerClassName}`;

export const authFormInputInvalidClassName =
    "!border-destructive/70 !ring-0 !shadow-none before:!hidden dark:!ring-0 has-[input:focus-visible]:!border-destructive/70 has-[input:focus-visible]:!ring-0";

/** Neutralizes InputGroup default invalid rings; pair with authFormInputInvalidClassName when invalid. */
export const authFormInputGroupClassName =
    "h-10 items-center rounded-lg border border-border/80 bg-background shadow-none before:!hidden has-[input[aria-invalid]]:!ring-0 has-[input[aria-invalid]]:!shadow-none dark:has-[input[aria-invalid]]:!ring-0 has-[input:focus-visible]:has-[input[aria-invalid]]:!ring-0 has-[input:focus-visible]:border-primary has-[input:focus-visible]:ring-[3px] has-[input:focus-visible]:ring-[var(--accent-glow)] dark:bg-background **:[input]:h-full **:[input]:min-h-0 **:[input]:border-0 **:[input]:bg-transparent **:[input]:px-3.5 **:[input]:py-0 **:[input]:text-sm **:[input]:leading-normal **:[input]:shadow-none **:[input]:ring-0 **:[input]:placeholder:text-muted-foreground/90 sm:**:[input]:h-full sm:**:[input]:leading-normal [&_[data-slot=input-group-addon]]:pe-2 [&_[data-slot=button]]:border-transparent [&_[data-slot=button]]:bg-transparent [&_[data-slot=button]]:shadow-none [&_[data-slot=button]]:hover:bg-black/5 [&_[data-slot=button]]:hover:text-foreground [&_[data-slot=button]]:focus-visible:ring-0 dark:[&_[data-slot=button]]:hover:bg-white/5";

export const authFormInputGroupInputClassName =
    "h-full min-h-0 w-full border-0 bg-transparent px-0 py-0 text-sm leading-normal shadow-none ring-0 placeholder:text-muted-foreground/90 sm:h-full sm:leading-normal";

export const authFormInputGroupButtonClassName =
    "size-9 shrink-0 text-muted-foreground hover:text-foreground";

export const authFormCardClassName =
    "gap-0 border-border bg-card py-0";

export const authFormPrimaryButtonClassName =
    "h-10 w-full rounded-lg border-primary bg-primary text-sm font-semibold text-primary-foreground shadow-md shadow-primary/20 transition-[background-color,transform] duration-200 hover:-translate-y-px hover:border-[#f5c200] hover:!bg-[#ffe066] hover:!text-primary-foreground active:translate-y-0 active:!bg-primary active:shadow-md disabled:hover:translate-y-0";

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
