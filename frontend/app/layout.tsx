import type { Metadata } from "next";
import { AlphaCreditWarningModal } from "@/components/alpha/alpha-credit-warning-modal";
import { Providers } from "@/components/providers";
import { SessionProvider } from "@/components/session-provider";
import { ThemeProvider } from "@/components/theme-provider";
import "./globals.css";
import { Inter, Geist_Mono } from "next/font/google";
import { cn } from "@/lib/utils";

const geistMono = Geist_Mono({subsets:['latin'],variable:'--font-mono'});

const interHeading = Inter({subsets:['latin'],variable:'--font-heading'});

const inter = Inter({subsets:['latin'],variable:'--font-sans'});

export const metadata: Metadata = {
    title: "Ananta Market Stack",
    description: "Secure multi-broker trading workspace",
    icons: {
        icon: "/logo-mark.svg",
        shortcut: "/logo-mark.svg",
        apple: "/logo-mark.svg"
    }
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
    return (
        <html
            lang="en"
            suppressHydrationWarning
            className={cn(inter.variable, interHeading.variable, geistMono.variable)}
        >
            <body className="font-sans" suppressHydrationWarning>
                <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
                    <Providers>
                        <SessionProvider>
                            {children}
                            <AlphaCreditWarningModal />
                        </SessionProvider>
                    </Providers>
                </ThemeProvider>
            </body>
        </html>
    );
}
