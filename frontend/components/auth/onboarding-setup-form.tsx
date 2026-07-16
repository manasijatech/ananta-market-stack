"use client";

import { useAuth, useSignUpEmail } from "@better-auth-ui/react";
import { IconCheck, IconEye, IconEyeOff } from "@tabler/icons-react";
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
    const [firstName, setFirstName] = useState("");
    const [lastName, setLastName] = useState("");
    const [email, setEmail] = useState("");
    const [password, setPassword] = useState("");
    const [confirmPassword, setConfirmPassword] = useState("");
    const [isPasswordVisible, setIsPasswordVisible] = useState(false);
    const [isConfirmPasswordVisible, setIsConfirmPasswordVisible] = useState(false);
    const [error, setError] = useState("");
    const [fieldErrors, setFieldErrors] = useState<{
        firstName?: string;
        lastName?: string;
        email?: string;
        password?: string;
        confirmPassword?: string;
    }>({});

    const passwordChecks = useMemo(() => getPasswordChecks(password), [password]);
    const passwordStrength = useMemo(() => getPasswordStrength(passwordChecks), [passwordChecks]);

    const { mutate: signUpEmail, isPending } = useSignUpEmail(authClient, {
        onError: (signUpError) => {
            setPassword("");
            setConfirmPassword("");
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

        if (!firstName.trim()) {
            nextErrors.firstName = "Enter your first name.";
        }

        if (!lastName.trim()) {
            nextErrors.lastName = "Enter your last name.";
        }

        if (!email.trim()) {
            nextErrors.email = "Enter your email.";
        }

        if (!passwordChecks.length) {
            nextErrors.password = "Use at least 8 characters.";
        }

        if (!confirmPassword) {
            nextErrors.confirmPassword = "Confirm your password.";
        } else if (password !== confirmPassword) {
            nextErrors.confirmPassword = "Passwords do not match.";
        }

        if (Object.keys(nextErrors).length > 0) {
            setFieldErrors(nextErrors);
            return;
        }

        setFieldErrors({});
        signUpEmail({
            name: `${firstName.trim()} ${lastName.trim()}`,
            email: email.trim(),
            password
        });
    }

    return (
        <Card className={authFormCardClassName}>
            <CardHeader>
                <CardTitle>Set up your workspace</CardTitle>
                <CardDescription>Create the first admin account to get started</CardDescription>
            </CardHeader>

            <CardPanel className="flex flex-col gap-6">
                <Alert variant="info">
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
                        <div className="grid gap-5 sm:grid-cols-2">
                            <Field data-invalid={!!fieldErrors.firstName}>
                                <FieldLabel htmlFor="onboarding-first-name">First name</FieldLabel>
                                <Input
                                    id="onboarding-first-name"
                                    name="firstName"
                                    type="text"
                                    autoComplete="given-name"
                                    placeholder="First Name"
                                    value={firstName}
                                    disabled={isPending}
                                    size="lg"
                                    onChange={(event) => {
                                        setFirstName(event.target.value);
                                        setFieldErrors((current) => ({ ...current, firstName: undefined }));
                                    }}
                                    aria-invalid={fieldErrors.firstName ? true : undefined}
                                />
                                <FieldError>{fieldErrors.firstName}</FieldError>
                            </Field>

                            <Field data-invalid={!!fieldErrors.lastName}>
                                <FieldLabel htmlFor="onboarding-last-name">Last name</FieldLabel>
                                <Input
                                    id="onboarding-last-name"
                                    name="lastName"
                                    type="text"
                                    autoComplete="family-name"
                                    placeholder="Last Name"
                                    value={lastName}
                                    disabled={isPending}
                                    size="lg"
                                    onChange={(event) => {
                                        setLastName(event.target.value);
                                        setFieldErrors((current) => ({ ...current, lastName: undefined }));
                                    }}
                                    aria-invalid={fieldErrors.lastName ? true : undefined}
                                />
                                <FieldError>{fieldErrors.lastName}</FieldError>
                            </Field>
                        </div>

                        <Field data-invalid={!!fieldErrors.email}>
                            <FieldLabel htmlFor="onboarding-email">Email</FieldLabel>
                            <Input
                                id="onboarding-email"
                                name="email"
                                type="email"
                                autoComplete="email"
                                placeholder="Email"
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
                            <InputGroup className="h-9.5">
                                <InputGroupInput
                                    id="onboarding-password"
                                    name="password"
                                    type={isPasswordVisible ? "text" : "password"}
                                    autoComplete="new-password"
                                    placeholder="Password"
                                    value={password}
                                    disabled={isPending}
                                    onChange={(event) => {
                                        setPassword(event.target.value);
                                        setFieldErrors((current) => ({
                                            ...current,
                                            confirmPassword:
                                                confirmPassword && event.target.value !== confirmPassword
                                                    ? current.confirmPassword
                                                    : undefined,
                                            password: undefined
                                        }));
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
                                <div className="flex w-full flex-col gap-3 pt-1">
                                    <div className="flex w-full flex-col gap-2">
                                        <div className="flex items-center justify-between text-xs">
                                            <span className="text-muted-foreground">Password strength</span>
                                            <span className="font-medium text-foreground">{passwordStrength.label}</span>
                                        </div>
                                        <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
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

                        <Field data-invalid={!!fieldErrors.confirmPassword}>
                            <FieldLabel htmlFor="onboarding-confirm-password">Confirm password</FieldLabel>
                            <InputGroup className="h-9.5">
                                <InputGroupInput
                                    id="onboarding-confirm-password"
                                    name="confirmPassword"
                                    type={isConfirmPasswordVisible ? "text" : "password"}
                                    autoComplete="new-password"
                                    placeholder="Confirm Password"
                                    value={confirmPassword}
                                    disabled={isPending}
                                    onChange={(event) => {
                                        setConfirmPassword(event.target.value);
                                        setFieldErrors((current) => ({ ...current, confirmPassword: undefined }));
                                    }}
                                    aria-invalid={fieldErrors.confirmPassword ? true : undefined}
                                />
                                <InputGroupAddon align="inline-end">
                                    <InputGroupButton
                                        type="button"
                                        size="icon-sm"
                                        className={authFormInputGroupButtonClassName}
                                        aria-label={isConfirmPasswordVisible ? "Hide confirm password" : "Show confirm password"}
                                        onClick={() => setIsConfirmPasswordVisible((current) => !current)}
                                    >
                                        {isConfirmPasswordVisible ? (
                                            <IconEyeOff aria-hidden="true" />
                                        ) : (
                                            <IconEye aria-hidden="true" />
                                        )}
                                    </InputGroupButton>
                                </InputGroupAddon>
                            </InputGroup>

                            <FieldError>{fieldErrors.confirmPassword}</FieldError>
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

                    </div>
                </form>
            </CardPanel>
        </Card>
    );
}
