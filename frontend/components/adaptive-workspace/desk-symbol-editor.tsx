"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export function DeskSymbolEditor({
    onChange,
    symbols
}: {
    onChange: (symbols: string[]) => void;
    symbols: string[];
}) {
    const [draft, setDraft] = useState("");

    function add() {
        const next = draft
            .split(/[\s,]+/)
            .map((item) => item.trim().toUpperCase())
            .filter(Boolean);
        if (!next.length) return;
        onChange(Array.from(new Set([...symbols, ...next])).slice(0, 40));
        setDraft("");
    }

    return (
        <div className="flex flex-wrap items-center gap-1.5 px-2 py-1.5">
            <Input
                aria-label="Add desk symbol"
                className="h-7 w-36"
                onChange={(event) => setDraft(event.target.value)}
                onKeyDown={(event) => {
                    if (event.key === "Enter") {
                        event.preventDefault();
                        add();
                    }
                }}
                placeholder="Add symbol"
                value={draft}
            />
            <Button onClick={add} size="xs" type="button" variant="outline">
                Add
            </Button>
            <p className="text-[11px] text-muted-foreground">{symbols.length}/40 desk</p>
        </div>
    );
}
