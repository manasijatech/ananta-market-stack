import { AuthSplitLayout } from "@/components/auth/auth-split-layout";
import { Skeleton } from "@/components/ui/skeleton";

function AuthFormSkeleton({ fields = 2 }: { fields?: number }) {
    return (
        <div className="flex w-full flex-col gap-6">
            <div className="space-y-2">
                <Skeleton className="h-9 w-40" />
                <Skeleton className="h-4 w-full max-w-sm" />
            </div>
            <div className="grid gap-4">
                {Array.from({ length: fields }).map((_, index) => (
                    <div key={index}>
                        <Skeleton className="mb-2 h-4 w-20" />
                        <Skeleton className="h-12 w-full rounded-lg" />
                    </div>
                ))}
            </div>
            <Skeleton className="h-12 w-full rounded-lg" />
        </div>
    );
}

export function SignInLoading() {
    return (
        <AuthSplitLayout>
            <AuthFormSkeleton />
        </AuthSplitLayout>
    );
}

export function SignUpLoading() {
    return (
        <AuthSplitLayout panel="approval">
            <AuthFormSkeleton fields={3} />
        </AuthSplitLayout>
    );
}
