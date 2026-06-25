"use client";

import { useAuth, useSignUpEmail } from "@better-auth-ui/react";
import { IconCheck, IconEye, IconEyeOff } from "@tabler/icons-react";
import { type FormEvent, useMemo, useState } from "react";
import {
    authFormCardClassName,
    authFormInputClassName,
    authFormInputGroupClassName,
    authFormPrimaryButtonClassName,
    getPasswordChecks,
    getPasswordStrength
} from "@/components/auth/auth-form-styles";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
    InputGroup,
    InputGroupAddon,
    InputGroupButton,
    InputGroupInput
} from "@/components/ui/input-group";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";

function RequirementRow({ met, label }: { met: boolean; label: string }) {
    return (
        <li className="flex items-center gap-2 text-sm">
            <IconCheck
                className={cn("size-3.5 shrink-0", met ? "text-primary" : "text-muted-foreground/50")}
                stroke={2.25}
            />
            <span className={cn(met ? "text-foreground" : "text-muted-foreground")}>{label}</span>
        </li>
    );
}

export function OnboardingSetupForm() {
    const { authClient, redirectTo, navigate } = useAuth();
    const [name, setName] = useState("");
    const [email, setEmail] = useState("");
    const [password, setPassword] = useState("");
    const [isPasswordVisible, setIsPasswordVisible] = useState(false);
    const [error, setError] = useState("");
    const [fieldErrors, setFieldErrors] = useState<{
        name?: string;
        email?: string;
        password?: string;
    }>({});

    const passwordChecks = useMemo(() => getPasswordChecks(password), [password]);
    const passwordStrength = useMemo(() => getPasswordStrength(passwordChecks), [passwordChecks]);

    const { mutate: signUpEmail, isPending } = useSignUpEmail(authClient, {
        onError: (signUpError) => {
            setPassword("");
            setError(signUpError.error?.message ?? "Could not create your account. Try again.");
        },
        onSuccess: () => {
            navigate({ to: redirectTo, replace: true });
        }
    });

    function handleSubmit(event: FormEvent<HTMLFormElement>) {
        event.preventDefault();
        setError("");

        const nextErrors: typeof fieldErrors = {};

        if (!name.trim()) {
            nextErrors.name = "Enter your full name.";
        }

        if (!email.trim()) {
            nextErrors.email = "Enter your work email.";
        }

        if (!passwordChecks.length) {
            nextErrors.password = "Use at least 8 characters.";
        }

        if (Object.keys(nextErrors).length > 0) {
            setFieldErrors(nextErrors);
            return;
        }

        setFieldErrors({});
        signUpEmail({ name: name.trim(), email: email.trim(), password });
    }

    return (
        <Card className={authFormCardClassName}>
            <CardHeader className="gap-4 border-b border-[var(--border-subtle)] px-6 py-6">
                <div className="space-y-3 rounded-lg border border-[var(--border-subtle)] bg-background/40 p-4 dark:bg-background/20">
                    <div className="space-y-1">
                        <p className="text-sm font-medium text-foreground">Workspace setup</p>
                        <p className="text-sm leading-relaxed text-muted-foreground">
                            The account you create will become the workspace administrator with full access to:
                        </p>
                    </div>
                    <ul className="space-y-1.5 text-sm text-muted-foreground">
                        <li className="flex items-center gap-2">
                            <span className="size-1.5 rounded-full bg-primary" />
                            Broker connections
                        </li>
                        <li className="flex items-center gap-2">
                            <span className="size-1.5 rounded-full bg-primary" />
                            Workspace settings
                        </li>
                    </ul>
                </div>

                <div className="space-y-1.5">
                    <CardTitle className="text-2xl font-semibold tracking-tight">Set up your workspace</CardTitle>
                    <CardDescription className="text-base text-muted-foreground">
                        Create the first admin account to get started
                    </CardDescription>
                </div>
            </CardHeader>

            <CardContent className="px-6 py-6">
                <form className="grid gap-6" onSubmit={handleSubmit}>
                    <FieldGroup className="gap-5">
                        <Field data-invalid={!!fieldErrors.name}>
                            <FieldLabel htmlFor="onboarding-name">Full name</FieldLabel>
                            <Input
                                id="onboarding-name"
                                name="name"
                                type="text"
                                autoComplete="name"
                                placeholder="Your full name"
                                value={name}
                                disabled={isPending}
                                className={authFormInputClassName}
                                onChange={(event) => {
                                    setName(event.target.value);
                                    setFieldErrors((current) => ({ ...current, name: undefined }));
                                }}
                                aria-invalid={!!fieldErrors.name}
                            />
                            <FieldError>{fieldErrors.name}</FieldError>
                        </Field>

                        <Field data-invalid={!!fieldErrors.email}>
                            <FieldLabel htmlFor="onboarding-email">Work email</FieldLabel>
                            <Input
                                id="onboarding-email"
                                name="email"
                                type="email"
                                autoComplete="email"
                                placeholder="you@company.com"
                                value={email}
                                disabled={isPending}
                                className={authFormInputClassName}
                                onChange={(event) => {
                                    setEmail(event.target.value);
                                    setFieldErrors((current) => ({ ...current, email: undefined }));
                                }}
                                aria-invalid={!!fieldErrors.email}
                            />
                            <FieldError>{fieldErrors.email}</FieldError>
                        </Field>

                        <Field data-invalid={!!fieldErrors.password}>
                            <FieldLabel htmlFor="onboarding-password">Password</FieldLabel>
                            <InputGroup className={authFormInputGroupClassName}>
                                <InputGroupInput
                                    id="onboarding-password"
                                    name="password"
                                    type={isPasswordVisible ? "text" : "password"}
                                    autoComplete="new-password"
                                    placeholder="At least 8 characters"
                                    value={password}
                                    disabled={isPending}
                                    className="h-12 px-4 text-base placeholder:text-muted-foreground/90"
                                    onChange={(event) => {
                                        setPassword(event.target.value);
                                        setFieldErrors((current) => ({ ...current, password: undefined }));
                                    }}
                                    aria-invalid={!!fieldErrors.password}
                                />
                                <InputGroupAddon align="inline-end">
                                    <InputGroupButton
                                        type="button"
                                        size="icon-sm"
                                        className="size-9 text-muted-foreground hover:text-foreground"
                                        aria-label={isPasswordVisible ? "Hide password" : "Show password"}
                                        onClick={() => setIsPasswordVisible((current) => !current)}
                                    >
                                        {isPasswordVisible ? (
                                            <IconEyeOff className="size-5" stroke={1.75} />
                                        ) : (
                                            <IconEye className="size-5" stroke={1.75} />
                                        )}
                                    </InputGroupButton>
                                </InputGroupAddon>
                            </InputGroup>

                            {password ? (
                                <div className="space-y-3 pt-1">
                                    <div className="space-y-2">
                                        <div className="flex items-center justify-between text-xs">
                                            <span className="text-muted-foreground">Password strength</span>
                                            <span className="font-medium text-foreground">{passwordStrength.label}</span>
                                        </div>
                                        <div className="h-1.5 overflow-hidden rounded-full bg-[var(--border-subtle)]">
                                            <div
                                                className={cn(
                                                    "h-full rounded-full transition-all duration-300",
                                                    passwordStrength.tone
                                                )}
                                                style={{ width: `${passwordStrength.percent}%` }}
                                            />
                                        </div>
                                    </div>
                                    <ul className="space-y-1.5">
                                        <RequirementRow met={passwordChecks.length} label="8+ characters" />
                                        <RequirementRow met={passwordChecks.number} label="One number" />
                                        <RequirementRow met={passwordChecks.uppercase} label="One uppercase letter" />
                                    </ul>
                                </div>
                            ) : null}

                            <FieldError>{fieldErrors.password}</FieldError>
                        </Field>
                    </FieldGroup>

                    {error ? <p className="text-sm text-destructive">{error}</p> : null}

                    <div className="space-y-3">
                        <Button
                            type="submit"
                            disabled={isPending}
                            className={authFormPrimaryButtonClassName}
                        >
                            {isPending ? <Spinner /> : null}
                            Create workspace
                        </Button>

                        <div className="flex items-start justify-center gap-2 text-center text-sm text-muted-foreground lg:hidden">
                            <IconCheck className="mt-0.5 size-4 shrink-0 text-primary" stroke={2} />
                            <span>Your password is encrypted and never stored in plain text.</span>
                        </div>
                    </div>
                </form>
            </CardContent>
        </Card>
    );
}
