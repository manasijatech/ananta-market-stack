"use client";

import { useAuth, useResetPassword } from "@better-auth-ui/react";
import { IconEye, IconEyeOff } from "@tabler/icons-react";
import { type SyntheticEvent, useEffect, useState } from "react";
import { toast } from "sonner";
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
import { cn } from "@/lib/utils";

export type ResetPasswordProps = {
    className?: string;
};

export function ResetPassword({ className }: ResetPasswordProps) {
    const { authClient, basePaths, emailAndPassword, localization, viewPaths, navigate, Link } = useAuth();

    const { mutate: resetPassword, isPending } = useResetPassword(authClient, {
        onSuccess: () => {
            toast.success(localization.auth.passwordResetSuccess);
            navigate({ to: `${basePaths.auth}/${viewPaths.auth.signIn}` });
        }
    });

    const [isPasswordVisible, setIsPasswordVisible] = useState(false);
    const [isConfirmPasswordVisible, setIsConfirmPasswordVisible] = useState(false);
    const [fieldErrors, setFieldErrors] = useState<{
        password?: string;
        confirmPassword?: string;
    }>({});

    useEffect(() => {
        const searchParams = new URLSearchParams(window.location.search);
        const token = searchParams.get("token");
        const error = searchParams.get("error");

        if (error || !token) {
            toast.error(localization.auth.invalidResetPasswordToken);
            navigate({ to: `${basePaths.auth}/${viewPaths.auth.signIn}` });
        }
    }, [basePaths.auth, localization.auth.invalidResetPasswordToken, navigate, viewPaths.auth.signIn]);

    function handleSubmit(event: SyntheticEvent<HTMLFormElement>) {
        event.preventDefault();

        const searchParams = new URLSearchParams(window.location.search);
        const token = searchParams.get("token");

        if (!token) {
            toast.error(localization.auth.invalidResetPasswordToken);
            navigate({ to: `${basePaths.auth}/${viewPaths.auth.signIn}` });
            return;
        }

        const formData = new FormData(event.currentTarget);
        const password = formData.get("password") as string;
        const confirmPassword = formData.get("confirmPassword") as string;

        if (emailAndPassword?.confirmPassword && password !== confirmPassword) {
            setFieldErrors((prev) => ({
                ...prev,
                confirmPassword: localization.auth.passwordsDoNotMatch
            }));
            return;
        }

        resetPassword({ token, newPassword: password });
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

    return (
        <div className={cn("flex w-full flex-col gap-5", className)}>
            <div className="space-y-1.5">
                <h1 className="text-2xl font-semibold tracking-tight">{localization.auth.resetPassword}</h1>
                <p className="text-sm leading-relaxed text-muted-foreground">
                    Choose a new password for your workspace account.
                </p>
            </div>

            <form className="grid gap-5" onSubmit={handleSubmit}>
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
                                disabled={isPending}
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

                    {emailAndPassword?.confirmPassword ? (
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
                                    disabled={isPending}
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
                    ) : null}
                </FieldGroup>

                <div className="space-y-5">
                    <Button type="submit" disabled={isPending} className={authFormPrimaryButtonClassName}>
                        {isPending ? <Spinner /> : null}
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
