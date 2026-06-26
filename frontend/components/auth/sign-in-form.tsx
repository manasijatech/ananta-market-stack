"use client";

import { authMutationKeys } from "@better-auth-ui/core";
import { useAuth, useFetchOptions, useSignInEmail } from "@better-auth-ui/react";
import { useIsMutating } from "@tanstack/react-query";
import { type SyntheticEvent, useState } from "react";
import { authFormPrimaryButtonClassName } from "@/components/auth/auth-form-styles";
import { ProviderButtons, type SocialLayout } from "@/components/auth/provider-buttons";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Field, FieldError, FieldGroup, FieldLabel, FieldSeparator } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Spinner } from "@/components/ui/spinner";

export type SignInFormProps = {
    socialLayout?: SocialLayout;
    socialPosition?: "top" | "bottom";
};

export function SignInForm({ socialLayout, socialPosition = "bottom" }: SignInFormProps) {
    const {
        authClient,
        basePaths,
        emailAndPassword,
        localization,
        plugins,
        redirectTo,
        socialProviders,
        viewPaths,
        navigate,
        Link
    } = useAuth();

    const { fetchOptions, resetFetchOptions } = useFetchOptions();
    const [password, setPassword] = useState("");
    const [fieldErrors, setFieldErrors] = useState<{ email?: string; password?: string }>({});

    const { mutate: signInEmail, isPending: signInEmailPending } = useSignInEmail(authClient, {
        onError: (error, { email }) => {
            setPassword("");
            if (error.error?.code === "EMAIL_NOT_VERIFIED") {
                sessionStorage.setItem("better-auth-ui.verify-email", email);
                navigate({ to: `${basePaths.auth}/${viewPaths.auth.verifyEmail}` });
            }
            resetFetchOptions();
        },
        onSuccess: () => navigate({ to: redirectTo })
    });

    const signInMutating = useIsMutating({ mutationKey: authMutationKeys.signIn.all });
    const signUpMutating = useIsMutating({ mutationKey: authMutationKeys.signUp.all });
    const isPending = signInMutating + signUpMutating > 0;

    const Captcha = plugins.find((plugin) => plugin.captchaComponent)?.captchaComponent;
    const showSeparator = emailAndPassword?.enabled && socialProviders && socialProviders.length > 0;

    function handleSubmit(event: SyntheticEvent<HTMLFormElement>) {
        event.preventDefault();
        const formData = new FormData(event.currentTarget);
        const email = formData.get("email") as string;
        const rememberMe = formData.get("rememberMe") === "on";

        signInEmail({
            email,
            password,
            ...(emailAndPassword?.rememberMe ? { rememberMe } : {}),
            fetchOptions
        });
    }

    return (
        <div className="flex w-full flex-col gap-5">
            <div className="space-y-1.5">
                <h1 className="text-2xl font-semibold tracking-tight">Sign in</h1>
                <p className="text-sm leading-relaxed text-muted-foreground">
                    Sign in to your workspace to manage broker connections and alerts.
                </p>
            </div>

            {socialPosition === "top" && socialProviders && socialProviders.length > 0 ? (
                <>
                    <ProviderButtons socialLayout={socialLayout} />
                    {showSeparator ? (
                        <FieldSeparator className="text-xs">{localization.auth.or}</FieldSeparator>
                    ) : null}
                </>
            ) : null}

            {emailAndPassword?.enabled ? (
                <form className="grid gap-5" onSubmit={handleSubmit}>
                    <FieldGroup className="gap-3.5">
                        <Field data-invalid={!!fieldErrors.email}>
                            <FieldLabel htmlFor="sign-in-email">{localization.auth.email}</FieldLabel>
                            <Input
                                id="sign-in-email"
                                name="email"
                                type="email"
                                autoComplete="email"
                                placeholder={localization.auth.emailPlaceholder}
                                required
                                disabled={isPending}
                                size="lg"
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

                        <Field data-invalid={!!fieldErrors.password}>
                            <div className="flex items-center justify-between gap-3">
                                <FieldLabel htmlFor="sign-in-password">{localization.auth.password}</FieldLabel>
                                {emailAndPassword.forgotPassword ? (
                                    <Link
                                        href={`${basePaths.auth}/${viewPaths.auth.forgotPassword}`}
                                        className="text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
                                    >
                                        {localization.auth.forgotPasswordLink}
                                    </Link>
                                ) : null}
                            </div>
                            <Input
                                id="sign-in-password"
                                name="password"
                                type="password"
                                autoComplete="current-password"
                                value={password}
                                onChange={(event) => {
                                    setPassword(event.target.value);
                                    setFieldErrors((prev) => ({ ...prev, password: undefined }));
                                }}
                                placeholder={localization.auth.passwordPlaceholder}
                                required
                                minLength={emailAndPassword.minPasswordLength}
                                maxLength={emailAndPassword.maxPasswordLength}
                                disabled={isPending}
                                size="lg"
                                onInvalid={(event) => {
                                    event.preventDefault();
                                    const element = event.target as HTMLInputElement;
                                    const min = emailAndPassword.minPasswordLength;
                                    const max = emailAndPassword.maxPasswordLength;
                                    setFieldErrors((prev) => ({
                                        ...prev,
                                        password: element.validity.valueMissing
                                            ? localization.auth.fieldRequired
                                            : element.validity.tooShort
                                              ? localization.auth.tooShort.replace("{{min}}", String(min))
                                              : localization.auth.tooLong.replace("{{max}}", String(max))
                                    }));
                                }}
                                aria-invalid={fieldErrors.password ? true : undefined}
                            />
                            <FieldError>{fieldErrors.password}</FieldError>
                        </Field>

                        {emailAndPassword.rememberMe ? (
                            <Field>
                                <div className="flex items-center gap-3">
                                    <Checkbox id="rememberMe" name="rememberMe" disabled={isPending} />
                                    <Label htmlFor="rememberMe" className="cursor-pointer text-sm font-normal text-muted-foreground">
                                        {localization.auth.rememberMe}
                                    </Label>
                                </div>
                            </Field>
                        ) : null}

                        {Captcha ? <div className="flex justify-center">{Captcha}</div> : null}
                    </FieldGroup>

                    <div className="space-y-5">
                        <Button type="submit" disabled={isPending} size="lg" className={authFormPrimaryButtonClassName}>
                            {signInEmailPending ? <Spinner /> : null}
                            {localization.auth.signIn}
                        </Button>

                        <p className="text-center text-sm text-muted-foreground">
                            {localization.auth.needToCreateAnAccount}{" "}
                            <Link
                                href={`${basePaths.auth}/${viewPaths.auth.signUp}`}
                                className="font-medium text-foreground underline underline-offset-4"
                            >
                                {localization.auth.signUp}
                            </Link>
                        </p>

                        {plugins.flatMap((plugin) =>
                            (plugin.authButtons ?? []).map((AuthButton, index) => (
                                <AuthButton key={`${plugin.id}-${index.toString()}`} view="signIn" />
                            ))
                        )}
                    </div>
                </form>
            ) : null}

            {socialPosition === "bottom" && socialProviders && socialProviders.length > 0 ? (
                <>
                    {showSeparator ? (
                        <FieldSeparator className="text-xs">{localization.auth.or}</FieldSeparator>
                    ) : null}
                    <ProviderButtons socialLayout={socialLayout} />
                </>
            ) : null}
        </div>
    );
}
