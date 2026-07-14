"use client";

import { useAuth, useFetchOptions, useRequestPasswordReset } from "@better-auth-ui/react";
import { type SyntheticEvent, useRef, useState } from "react";
import { toast } from "sonner";
import {
    authFormInputClassName,
    authFormInputInvalidClassName,
    authFormPrimaryButtonClassName
} from "@/components/auth/auth-form-styles";
import { Button } from "@/components/ui/button";
import { Field, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";

export type ForgotPasswordProps = {
    className?: string;
};

export function ForgotPassword({ className }: ForgotPasswordProps) {
    const { authClient, baseURL, basePaths, localization, plugins, viewPaths, Link } = useAuth();
    const { fetchOptions, resetFetchOptions } = useFetchOptions();
    const submittedEmailRef = useRef("");
    const [fieldErrors, setFieldErrors] = useState<{ email?: string }>({});

    const { mutate: requestPasswordReset, isPending } = useRequestPasswordReset(authClient, {
        onError: () => {
            resetFetchOptions();
        },
        onSuccess: () => {
            toast.success(localization.auth.passwordResetEmailSent);
            void loadDevResetLink(submittedEmailRef.current);
        }
    });

    async function loadDevResetLink(email: string) {
        if (!email) {
            return;
        }

        const response = await fetch(`/api/auth/dev-password-reset-link?email=${encodeURIComponent(email)}`, {
            cache: "no-store"
        }).catch(() => null);

        if (!response?.ok) {
            return;
        }

        const payload = (await response.json().catch(() => null)) as { url?: string | null } | null;
        if (payload?.url) {
            window.location.assign(payload.url);
        }
    }

    function handleSubmit(event: SyntheticEvent<HTMLFormElement>) {
        event.preventDefault();
        const formData = new FormData(event.currentTarget);
        const email = formData.get("email") as string;
        submittedEmailRef.current = email;
        requestPasswordReset({
            email,
            redirectTo: `${baseURL}${basePaths.auth}/${viewPaths.auth.resetPassword}`,
            fetchOptions
        });
    }

    const Captcha = plugins.find((plugin) => plugin.captchaComponent)?.captchaComponent;

    return (
        <div className={cn("flex w-full flex-col gap-5", className)}>
            <div className="space-y-1.5">
                <h1 className="text-2xl font-semibold tracking-tight">{localization.auth.forgotPassword}</h1>
                <p className="text-sm leading-relaxed text-muted-foreground">
                    Enter your account email to continue with password reset.
                </p>
            </div>

            <form className="grid gap-5" onSubmit={handleSubmit}>
                <FieldGroup className="gap-3.5">
                    <Field data-invalid={!!fieldErrors.email}>
                        <FieldLabel htmlFor="forgot-password-email">{localization.auth.email}</FieldLabel>
                        <Input
                            id="forgot-password-email"
                            name="email"
                            type="email"
                            autoComplete="email"
                            placeholder={localization.auth.emailPlaceholder}
                            required
                            disabled={isPending}
                            className={cn(authFormInputClassName, fieldErrors.email && authFormInputInvalidClassName)}
                            onChange={() => setFieldErrors((prev) => ({ ...prev, email: undefined }))}
                            onInvalid={(event) => {
                                event.preventDefault();
                                const element = event.target as HTMLInputElement;
                                setFieldErrors((prev) => ({
                                    ...prev,
                                    email: element.validity.valueMissing
                                        ? localization.auth.fieldRequired
                                        : localization.auth.invalidEmail
                                }));
                            }}
                            aria-invalid={fieldErrors.email ? true : undefined}
                        />
                        <FieldError>{fieldErrors.email}</FieldError>
                    </Field>

                    {Captcha ? <div className="flex justify-center">{Captcha}</div> : null}
                </FieldGroup>

                <div className="space-y-5">
                    <Button type="submit" disabled={isPending} className={authFormPrimaryButtonClassName}>
                        {isPending ? <Spinner /> : null}
                        Continue
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
