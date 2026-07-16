import "server-only";

import { requireActiveWorkspace } from "@/lib/auth-guards";
import { BrandLogo } from "@/components/brand-logo";

export async function DocsShell({ children }: { children: React.ReactNode }) {
    await requireActiveWorkspace();

    return (
        <main className="app-page-background min-h-screen">
            <header className="border-b border-border">
                <div className="mx-auto flex min-h-16 w-full max-w-5xl items-center px-4">
                    <BrandLogo imageClassName="text-[1.35rem]" />
                </div>
            </header>
            <div className="mx-auto w-full max-w-5xl px-4 py-8">{children}</div>
        </main>
    );
}
