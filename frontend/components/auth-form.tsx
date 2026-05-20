"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, KeyboardEvent, useRef, useState } from "react";
import { useSession } from "@/components/session-provider";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RippleButton } from "@/components/ui/ripple-button";

type AuthMode = "sign-in" | "sign-up";

export function AuthForm({ mode }: { mode: AuthMode }) {
    const router = useRouter();
    const { signIn, signUp } = useSession();
    const [error, setError] = useState("");
    const [isSubmitting, setIsSubmitting] = useState(false);
    const emailRef = useRef<HTMLInputElement | null>(null);
    const passwordRef = useRef<HTMLInputElement | null>(null);

    function focusOnEnter(event: KeyboardEvent<HTMLInputElement>, nextField: "email" | "password") {
        if (event.key !== "Enter") {
            return;
        }
        event.preventDefault();
        if (nextField === "email") {
            emailRef.current?.focus();
        } else {
            passwordRef.current?.focus();
        }
    }

    async function onSubmit(event: FormEvent<HTMLFormElement>) {
        event.preventDefault();
        setError("");
        setIsSubmitting(true);

        const formData = new FormData(event.currentTarget);
        const email = String(formData.get("email") ?? "");
        const password = String(formData.get("password") ?? "");
        const displayName = String(formData.get("displayName") ?? "");
        const rememberMe = formData.get("remember") === "on";

        try {
            if (mode === "sign-up") {
                await signUp({ email, password, displayName });
            } else {
                await signIn({ email, password, rememberMe });
            }
            router.replace("/dashboard");
        } catch (caught) {
            setError(caught instanceof Error ? caught.message : "Something went wrong.");
        } finally {
            setIsSubmitting(false);
        }
    }

    return (
        <form className="grid gap-5" onSubmit={onSubmit}>
            {mode === "sign-up" ? (
                <div className="grid gap-2">
                    <Label htmlFor="displayName">Name</Label>
                    <Input
                        autoComplete="name"
                        id="displayName"
                        name="displayName"
                        onKeyDown={(event) => focusOnEnter(event, "email")}
                        placeholder="Aarav Sharma"
                        required
                        className="h-12"
                        type="text"
                    />
                </div>
            ) : null}

            <div className="grid gap-2">
                <Label htmlFor="email">Email</Label>
                <Input
                    autoComplete="email"
                    id="email"
                    inputMode="email"
                    name="email"
                    onKeyDown={(event) => focusOnEnter(event, "password")}
                    placeholder="you@example.com"
                    ref={emailRef}
                    required
                    className="h-12"
                    type="email"
                />
            </div>

            <div className="grid gap-2">
                <Label htmlFor="password">Password</Label>
                <Input
                    autoComplete={mode === "sign-up" ? "new-password" : "current-password"}
                    id="password"
                    minLength={8}
                    name="password"
                    placeholder="At least 8 characters"
                    ref={passwordRef}
                    required
                    className="h-12"
                    type="password"
                />
            </div>

            {mode === "sign-in" ? (
                <div className="flex flex-col items-stretch justify-between gap-3.5 min-[920px]:flex-row min-[920px]:items-center">
                    <Label className="cursor-pointer text-[13px] font-normal" htmlFor="remember">
                        <Checkbox id="remember" name="remember" defaultChecked />
                        Keep me signed in
                    </Label>
                    <Link className="text-[13px] font-bold text-primary hover:underline" href="/auth/sign-in">
                        Forgot password?
                    </Link>
                </div>
            ) : null}

            {error ? (
                <Alert variant="destructive">
                    <AlertDescription>{error}</AlertDescription>
                </Alert>
            ) : null}

            {mode === "sign-in" ? (
                <RippleButton className="mt-1 h-12 w-full font-extrabold" disabled={isSubmitting} type="submit">
                    {isSubmitting ? "Please wait..." : "Sign in"}
                </RippleButton>
            ) : (
                <Button className="mt-1 h-12 w-full font-extrabold" disabled={isSubmitting} type="submit">
                    {isSubmitting ? "Please wait..." : "Create account"}
                </Button>
            )}
        </form>
    );
}
