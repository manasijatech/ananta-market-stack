export const authFormCardClassName = "w-full gap-0 py-0";

export const authFormInputClassName = "";

export const authFormInputInvalidClassName = "";

export const authFormInputGroupClassName = "";

export const authFormInputGroupInputClassName = "";

export const authFormInputGroupButtonClassName =
    "text-muted-foreground hover:text-foreground";

export const authFormPrimaryButtonClassName = "w-full";

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
        return { label: "Enter a password", percent: 0, tone: "bg-muted" };
    }

    if (score === 1) {
        return { label: "Weak", percent: 33, tone: "bg-destructive/80" };
    }

    if (score === 2) {
        return { label: "Fair", percent: 66, tone: "bg-primary/70" };
    }

    return { label: "Strong", percent: 100, tone: "bg-primary" };
}
