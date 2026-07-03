"use client";

import { useAuth, useSignUpEmail } from "@better-auth-ui/react";
import { IconCheck, IconEye, IconEyeOff, IconInfoCircle } from "@tabler/icons-react";
import { type FormEvent, useMemo, useState } from "react";
import {
    authFormCardClassName,
    authFormInputGroupButtonClassName,
    authFormPrimaryButtonClassName,
    getPasswordChecks,
    getPasswordStrength
} from "@/components/auth/auth-form-styles";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardHeader, CardPanel, CardTitle } from "@/components/ui/card";
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
                aria-hidden="true"
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
            <CardHeader>
                <CardTitle>Set up your workspace</CardTitle>
                <CardDescription>Create the first admin account to get started</CardDescription>
            </CardHeader>

            <CardPanel className="flex flex-col gap-6">
                <Alert variant="info">
                    <IconInfoCircle aria-hidden="true" />
                    <AlertTitle>Workspace setup</AlertTitle>
                    <AlertDescription>
                        <p>
                            The account you create will become the workspace administrator with full
                            access to:
                        </p>
                        <ul className="mt-2 flex flex-col gap-1.5">
                            <li className="flex items-center gap-2">
                                <span className="size-1.5 rounded-full bg-info" />
                                Broker connections
                            </li>
                            <li className="flex items-center gap-2">
                                <span className="size-1.5 rounded-full bg-info" />
                                Workspace settings
                            </li>
                        </ul>
                    </AlertDescription>
                </Alert>

                <form className="flex flex-col gap-6" onSubmit={handleSubmit}>
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
                                size="lg"
                                onChange={(event) => {
                                    setName(event.target.value);
                                    setFieldErrors((current) => ({ ...current, name: undefined }));
                                }}
                                aria-invalid={fieldErrors.name ? true : undefined}
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
                                size="lg"
                                onChange={(event) => {
                                    setEmail(event.target.value);
                                    setFieldErrors((current) => ({ ...current, email: undefined }));
                                }}
                                aria-invalid={fieldErrors.email ? true : undefined}
                            />
                            <FieldError>{fieldErrors.email}</FieldError>
                        </Field>

                        <Field data-invalid={!!fieldErrors.password}>
                            <FieldLabel htmlFor="onboarding-password">Password</FieldLabel>
                            <InputGroup>
                                <InputGroupInput
                                    id="onboarding-password"
                                    name="password"
                                    type={isPasswordVisible ? "text" : "password"}
                                    autoComplete="new-password"
                                    placeholder="At least 8 characters"
                                    value={password}
                                    disabled={isPending}
                                    onChange={(event) => {
                                        setPassword(event.target.value);
                                        setFieldErrors((current) => ({ ...current, password: undefined }));
                                    }}
                                    aria-invalid={fieldErrors.password ? true : undefined}
                                />
                                <InputGroupAddon align="inline-end">
                                    <InputGroupButton
                                        type="button"
                                        size="icon-sm"
                                        className={authFormInputGroupButtonClassName}
                                        aria-label={isPasswordVisible ? "Hide password" : "Show password"}
                                        onClick={() => setIsPasswordVisible((current) => !current)}
                                    >
                                        {isPasswordVisible ? (
                                            <IconEyeOff aria-hidden="true" />
                                        ) : (
                                            <IconEye aria-hidden="true" />
                                        )}
                                    </InputGroupButton>
                                </InputGroupAddon>
                            </InputGroup>

                            {password ? (
                                <div className="flex flex-col gap-3 pt-1">
                                    <div className="flex flex-col gap-2">
                                        <div className="flex items-center justify-between text-xs">
                                            <span className="text-muted-foreground">Password strength</span>
                                            <span className="font-medium text-foreground">{passwordStrength.label}</span>
                                        </div>
                                        <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                                            <div
                                                className={cn(
                                                    "h-full rounded-full transition-all duration-300",
                                                    passwordStrength.tone
                                                )}
                                                style={{ width: `${passwordStrength.percent}%` }}
                                            />
                                        </div>
                                    </div>
                                    <ul className="flex flex-col gap-1.5">
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

                    <div className="flex flex-col gap-3">
                        <Button
                            type="submit"
                            disabled={isPending}
                            size="lg"
                            className={authFormPrimaryButtonClassName}
                        >
                            {isPending ? <Spinner /> : null}
                            Create workspace
                        </Button>

                        <div className="flex items-start justify-center gap-2 text-center text-sm text-muted-foreground lg:hidden">
                            <IconCheck className="mt-0.5 size-4 shrink-0 text-primary" stroke={2} aria-hidden="true" />
                            <span>Your password is encrypted and never stored in plain text.</span>
                        </div>
                    </div>
                </form>
            </CardPanel>
        </Card>
    );
}
