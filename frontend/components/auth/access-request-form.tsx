"use client";



import { useAuth, useSignUpEmail } from "@better-auth-ui/react";

import { IconArrowRight, IconCheck, IconEye, IconEyeOff } from "@tabler/icons-react";

import Link from "next/link";

import { useRouter } from "next/navigation";

import { type FormEvent, useMemo, useState } from "react";

import {
    authFormInputGroupButtonClassName,
    authFormPrimaryButtonClassName,
    getPasswordChecks,
    getPasswordStrength
} from "@/components/auth/auth-form-styles";
import { ApprovalNoticeCard } from "@/components/auth/auth-split-layout";

import { Button } from "@/components/ui/button";

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



function RequestSubmittedSuccess({ onBackToSignIn }: { onBackToSignIn: () => void }) {

    return (

        <div className="flex w-full flex-col gap-8">

            <div className="space-y-4 text-center">

                <div className="mx-auto flex size-12 items-center justify-center rounded-full bg-primary/10 text-primary">

                    <IconCheck className="size-6" stroke={2} />

                </div>

                <div className="space-y-2">

                    <h1 className="text-2xl font-semibold tracking-tight">Request submitted</h1>

                    <p className="text-sm leading-relaxed text-muted-foreground">

                        Your account is pending administrator approval. You&apos;ll be able to sign in once your

                        request is approved.

                    </p>

                </div>

            </div>

            <Button type="button" size="lg" className={authFormPrimaryButtonClassName} onClick={onBackToSignIn}>

                Back to sign in

            </Button>

        </div>

    );

}



export function AccessRequestForm() {

    const router = useRouter();

    const { authClient, basePaths, viewPaths, Link: AuthLink } = useAuth();

    const [name, setName] = useState("");

    const [email, setEmail] = useState("");

    const [password, setPassword] = useState("");

    const [isPasswordVisible, setIsPasswordVisible] = useState(false);

    const [submitted, setSubmitted] = useState(false);

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

            setSubmitted(true);

        }

    });



    async function backToSignIn() {

        await authClient.signOut();

        router.replace(`${basePaths.auth}/${viewPaths.auth.signIn}`);

    }



    function handleSubmit(event: FormEvent<HTMLFormElement>) {

        event.preventDefault();

        setError("");



        const nextErrors: typeof fieldErrors = {};



        if (!name.trim()) {

            nextErrors.name = "Enter your full name.";

        }



        if (!email.trim()) {

            nextErrors.email = "Enter your email.";

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



    if (submitted) {

        return <RequestSubmittedSuccess onBackToSignIn={backToSignIn} />;

    }



    const SignInLink = AuthLink ?? Link;



    return (
        <div className="flex w-full flex-col gap-5">
            <ApprovalNoticeCard className="lg:hidden" />


            <div className="space-y-1.5">
                <h1 className="text-2xl font-semibold tracking-tight">Create account</h1>
                <p className="text-sm leading-relaxed text-muted-foreground">
                    Create your login credentials to request access to this workspace.
                </p>
            </div>

            <form className="grid gap-5" onSubmit={handleSubmit}>

                <FieldGroup className="gap-3.5">

                    <Field data-invalid={!!fieldErrors.name}>

                        <FieldLabel htmlFor="access-request-name">Full name</FieldLabel>

                        <Input

                            id="access-request-name"

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

                        <FieldLabel htmlFor="access-request-email">Email</FieldLabel>

                        <Input

                            id="access-request-email"

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

                        <FieldLabel htmlFor="access-request-password">Password</FieldLabel>

                        <InputGroup>

                            <InputGroupInput

                                id="access-request-password"

                                name="password"

                                type={isPasswordVisible ? "text" : "password"}

                                autoComplete="new-password"

                                placeholder="Minimum 8 characters"

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



                <div className="space-y-5">

                    <Button type="submit" disabled={isPending} size="lg" className={authFormPrimaryButtonClassName}>

                        {isPending ? <Spinner /> : null}

                        Create account

                    </Button>



                    <p className="text-center text-sm text-muted-foreground">

                        Questions? Contact your workspace administrator.

                    </p>



                    <p className="text-center text-sm text-muted-foreground">

                        Already approved?{" "}

                        <SignInLink

                            href={`${basePaths.auth}/${viewPaths.auth.signIn}`}

                            className="inline-flex items-center gap-1 font-medium text-foreground underline underline-offset-4"

                        >

                            Sign in

                            <IconArrowRight className="size-3.5" stroke={1.75} />

                        </SignInLink>

                    </p>

                </div>

            </form>

        </div>

    );

}


