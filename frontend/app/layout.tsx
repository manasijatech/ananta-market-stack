import type { Metadata } from "next";
import { AlphaCreditWarningModal } from "@/components/alpha/alpha-credit-warning-modal";
import { SessionProvider } from "@/components/session-provider";
import { ThemeProvider } from "@/components/theme-provider";
import "./globals.css";

export const metadata: Metadata = {
    title: "Ananta Market Stack",
    description: "Secure multi-broker trading workspace"
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
    return (
        <html lang="en" suppressHydrationWarning>
            <body suppressHydrationWarning>
                <ThemeProvider attribute="class" defaultTheme="dark" disableTransitionOnChange>
                    <SessionProvider>
                        {children}
                        <AlphaCreditWarningModal />
                    </SessionProvider>
                </ThemeProvider>
            </body>
        </html>
    );
}
