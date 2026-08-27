"use client";

import { useAuth, useResetPassword } from "@better-auth-ui/react";
import { IconEye, IconEyeOff } from "@tabler/icons-react";
import { type SyntheticEvent, useEffect, useState } from "react";
import {
    authFormInputGroupButtonClassName,
    authFormInputGroupClassName,
    authFormInputGroupInputClassName,
    authFormInputInvalidClassName,
    authFormPrimaryButtonClassName
} from "@/components/auth/auth-form-styles";
import { Button } from "@/components/ui/button";
import { Field, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from "@/components/ui/input-group";
import { Spinner } from "@/components/ui/spinner";
import { extractResetPasswordToken } from "@/lib/auth-reset";
import { cn } from "@/lib/utils";
import { resolvePostAuthRoute } from "@/service/actions/auth-routing";
import { resetPasswordAction } from "@/service/actions/auth-session";

export type ResetPasswordProps = {
    className?: string;
};

export function ResetPassword({ className }: ResetPasswordProps) {
    const { authClient, basePaths, emailAndPassword, localization, viewPaths, Link } = useAuth();
    const [token, setToken] = useState("");
    const [isPasswordVisible, setIsPasswordVisible] = useState(false);
    const [isConfirmPasswordVisible, setIsConfirmPasswordVisible] = useState(false);
    const [fieldErrors, setFieldErrors] = useState<{
        password?: string;
        confirmPassword?: string;
    }>({});
    const [formError, setFormError] = useState<string | null>(null);
    const [isRedirecting, setIsRedirecting] = useState(false);

    const { mutate: resetPassword, isPending } = useResetPassword(authClient, {
        onError: (error) => {
            setIsRedirecting(false);
            setFormError(error.error?.message || "Could not reset password. Request a new link.");
        },
        onSuccess: () => {
            setIsRedirecting(true);
            void (async () => {
                const destination = await resolvePostAuthRoute().catch(() => "/broker-connections");
                window.location.assign(destination);
            })();
        }
    });

    useEffect(() => {
        const params = new URLSearchParams(window.location.search);
        const extracted = extractResetPasswordToken(window.location.href) ?? params.get("token") ?? "";
        setToken(extracted);
        const error = params.get("error");
        if (error) {
            setFormError(error);
        }
    }, []);

    function handleSubmit(event: SyntheticEvent<HTMLFormElement>) {
        event.preventDefault();

        const formData = new FormData(event.currentTarget);
        const password = formData.get("password") as string;
        const confirmPassword = formData.get("confirmPassword") as string;
        const submitToken = (formData.get("token") as string) || token;

        if (!submitToken) {
            setFormError("This reset link is missing or expired. Request a new one.");
            return;
        }

        if (password !== confirmPassword) {
            setFieldErrors((prev) => ({
                ...prev,
                confirmPassword: localization.auth.passwordsDoNotMatch
            }));
            return;
        }

        setFormError(null);
        resetPassword({ token: submitToken, newPassword: password });
    }

    function passwordInvalidMessage(element: HTMLInputElement) {
        const min = emailAndPassword?.minPasswordLength;
        const max = emailAndPassword?.maxPasswordLength;

        return element.validity.valueMissing
            ? localization.auth.fieldRequired
            : element.validity.tooShort
              ? localization.auth.tooShort.replace("{{min}}", String(min))
              : localization.auth.tooLong.replace("{{max}}", String(max));
    }

    const busy = isPending || isRedirecting;

    if (!token && formError) {
        return (
            <div className={cn("flex w-full flex-col gap-5", className)}>
                <div className="space-y-1.5">
                    <h1 className="text-2xl font-semibold tracking-tight">{localization.auth.resetPassword}</h1>
                    <p className="text-sm text-destructive">{formError}</p>
                </div>
                <p className="text-sm text-muted-foreground">
                    <Link
                        href={`${basePaths.auth}/${viewPaths.auth.forgotPassword}`}
                        className="font-medium text-foreground underline underline-offset-4"
                    >
                        Request a new reset link
                    </Link>
                </p>
            </div>
        );
    }

    return (
        <div className={cn("flex w-full flex-col gap-5", className)}>
            <div className="space-y-1.5">
                <h1 className="text-2xl font-semibold tracking-tight">{localization.auth.resetPassword}</h1>
                <p className="text-sm leading-relaxed text-muted-foreground">
                    Choose a new password for your workspace account.
                </p>
            </div>

            {!token ? (
                <p className="rounded-lg border border-border bg-muted/40 px-3 py-2 text-sm text-foreground">
                    This page needs a valid reset token.{" "}
                    <Link
                        href={`${basePaths.auth}/${viewPaths.auth.forgotPassword}`}
                        className="font-medium underline underline-offset-4"
                    >
                        Request a new link
                    </Link>
                    .
                </p>
            ) : null}

            {formError ? <p className="text-sm text-destructive">{formError}</p> : null}

            <form className="grid gap-5" method="POST" action={resetPasswordAction} onSubmit={handleSubmit}>
                <input type="hidden" name="token" value={token} />
                <FieldGroup className="gap-3.5">
                    <Field data-invalid={!!fieldErrors.password}>
                        <FieldLabel htmlFor="reset-password">{localization.auth.password}</FieldLabel>
                        <InputGroup
                            className={cn(
                                authFormInputGroupClassName,
                                fieldErrors.password && authFormInputInvalidClassName
                            )}
                        >
                            <InputGroupInput
                                id="reset-password"
                                name="password"
                                type={isPasswordVisible ? "text" : "password"}
                                autoComplete="new-password"
                                placeholder={localization.auth.newPasswordPlaceholder}
                                required
                                minLength={emailAndPassword?.minPasswordLength}
                                maxLength={emailAndPassword?.maxPasswordLength}
                                disabled={busy || !token}
                                className={authFormInputGroupInputClassName}
                                onChange={() => setFieldErrors((prev) => ({ ...prev, password: undefined }))}
                                onInvalid={(event) => {
                                    event.preventDefault();
                                    setFieldErrors((prev) => ({
                                        ...prev,
                                        password: passwordInvalidMessage(event.target as HTMLInputElement)
                                    }));
                                }}
                                aria-invalid={fieldErrors.password ? true : undefined}
                            />
                            <InputGroupAddon align="inline-end">
                                <InputGroupButton
                                    type="button"
                                    size="icon-sm"
                                    className={authFormInputGroupButtonClassName}
                                    aria-label={
                                        isPasswordVisible
                                            ? localization.auth.hidePassword
                                            : localization.auth.showPassword
                                    }
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
                        <FieldError>{fieldErrors.password}</FieldError>
                    </Field>

                    <Field data-invalid={!!fieldErrors.confirmPassword}>
                        <FieldLabel htmlFor="reset-confirm-password">
                            {localization.auth.confirmPassword}
                        </FieldLabel>
                        <InputGroup
                            className={cn(
                                authFormInputGroupClassName,
                                fieldErrors.confirmPassword && authFormInputInvalidClassName
                            )}
                        >
                            <InputGroupInput
                                id="reset-confirm-password"
                                name="confirmPassword"
                                type={isConfirmPasswordVisible ? "text" : "password"}
                                autoComplete="new-password"
                                placeholder={localization.auth.confirmPasswordPlaceholder}
                                required
                                minLength={emailAndPassword?.minPasswordLength}
                                maxLength={emailAndPassword?.maxPasswordLength}
                                disabled={busy || !token}
                                className={authFormInputGroupInputClassName}
                                onChange={() => setFieldErrors((prev) => ({ ...prev, confirmPassword: undefined }))}
                                onInvalid={(event) => {
                                    event.preventDefault();
                                    setFieldErrors((prev) => ({
                                        ...prev,
                                        confirmPassword: passwordInvalidMessage(event.target as HTMLInputElement)
                                    }));
                                }}
                                aria-invalid={fieldErrors.confirmPassword ? true : undefined}
                            />
                            <InputGroupAddon align="inline-end">
                                <InputGroupButton
                                    type="button"
                                    size="icon-sm"
                                    className={authFormInputGroupButtonClassName}
                                    aria-label={
                                        isConfirmPasswordVisible
                                            ? localization.auth.hidePassword
                                            : localization.auth.showPassword
                                    }
                                    onClick={() => setIsConfirmPasswordVisible((current) => !current)}
                                >
                                    {isConfirmPasswordVisible ? (
                                        <IconEyeOff className="size-5" stroke={1.75} />
                                    ) : (
                                        <IconEye className="size-5" stroke={1.75} />
                                    )}
                                </InputGroupButton>
                            </InputGroupAddon>
                        </InputGroup>
                        <FieldError>{fieldErrors.confirmPassword}</FieldError>
                    </Field>
                </FieldGroup>

                <div className="space-y-5">
                    <Button type="submit" disabled={busy || !token} className={authFormPrimaryButtonClassName}>
                        {busy ? <Spinner /> : null}
                        {localization.auth.resetPassword}
                    </Button>

                    <p className="text-center text-sm text-muted-foreground">
                        {localization.auth.rememberYourPassword}{" "}
                        <Link
                            href={`${basePaths.auth}/${viewPaths.auth.signIn}`}
                            className="font-medium text-foreground underline underline-offset-4"
                        >
                            {localization.auth.signIn}
                        </Link>
                    </p>
                </div>
            </form>
        </div>
    );
}
