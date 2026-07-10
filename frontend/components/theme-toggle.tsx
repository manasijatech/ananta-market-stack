"use client";

import { Moon, Sun } from "lucide-react";
import { useTheme } from "next-themes";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";

export function ThemeToggle() {
    const { setTheme } = useTheme();
    const [mounted, setMounted] = useState(false);

    useEffect(() => {
        setMounted(true);
    }, []);

    function toggleTheme() {
        if (!mounted) return;
        const darkActive = document.documentElement.classList.contains("dark");
        setTheme(darkActive ? "light" : "dark");
    }

    return (
        <Button
            aria-label="Toggle theme"
            className="relative"
            size="icon"
            type="button"
            variant="outline"
            onClick={toggleTheme}
        >
            <Sun className="size-4 rotate-0 scale-100 transition-all dark:-rotate-90 dark:scale-0" />
            <Moon className="absolute size-4 rotate-90 scale-0 transition-all dark:rotate-0 dark:scale-100" />
        </Button>
    );
}
