import type { Metadata, Viewport } from "next";
import { AlphaCreditWarningModal } from "@/components/alpha/alpha-credit-warning-modal";
import { Providers } from "@/components/providers";
import { SessionProvider } from "@/components/session-provider";
import { ThemeProvider } from "@/components/theme-provider";
import "./globals.css";
import { Rethink_Sans, Geist_Mono } from "next/font/google";
import { cn } from "@/lib/utils";

const geistMono = Geist_Mono({ subsets: ["latin"], variable: "--font-mono" });

// Rethink Sans across the platform: a tall-x-height geometric sans that holds up
// bold + tight at display sizes (headings) and stays readable at body sizes.
const rethinkHeading = Rethink_Sans({ subsets: ["latin"], variable: "--font-heading" });

const rethinkSans = Rethink_Sans({ subsets: ["latin"], variable: "--font-sans" });

export const metadata: Metadata = {
    title: "Ananta",
    description: "Secure multi-broker trading workspace",
    icons: {
        icon: "/logo-mark.svg",
        shortcut: "/logo-mark.svg",
        apple: "/logo-mark.svg"
    }
};

export const viewport: Viewport = {
    width: "device-width",
    initialScale: 1,
    viewportFit: "cover"
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
    return (
        <html
            lang="en"
            suppressHydrationWarning
            className={cn(rethinkSans.variable, rethinkHeading.variable, geistMono.variable)}
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
