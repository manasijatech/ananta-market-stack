"use client";

import { useEffect, useRef, useState } from "react";
import { LiveStatusBadge } from "@/components/adaptive-workspace/widget-kit";
import type { WorkspaceComponent } from "@/service/types/adaptive-workspace";

const NOTES_MAX = 16000;
const SAVE_MS = 500;

type Props = {
    component: WorkspaceComponent;
    onPatch: (props: Record<string, unknown>) => void;
};

function notesText(component: WorkspaceComponent): string {
    return typeof component.props?.text === "string" ? component.props.text : "";
}

export function LiveNotesWidget({ component, onPatch }: Props) {
    const saved = notesText(component);
    const [draft, setDraft] = useState(saved);
    const [focused, setFocused] = useState(false);
    const [pending, setPending] = useState(false);
    const timerRef = useRef<number | null>(null);
    const savedRef = useRef(saved);
    const onPatchRef = useRef(onPatch);
    const draftRef = useRef(draft);
    savedRef.current = saved;
    onPatchRef.current = onPatch;
    draftRef.current = draft;

    useEffect(() => {
        if (focused) return;
        if (timerRef.current) {
            window.clearTimeout(timerRef.current);
            timerRef.current = null;
        }
        setPending(false);
        setDraft(saved);
    }, [focused, saved]);

    function flush(text: string) {
        const next = text.slice(0, NOTES_MAX);
        if (timerRef.current) {
            window.clearTimeout(timerRef.current);
            timerRef.current = null;
        }
        setPending(false);
        if (next === savedRef.current) return;
        onPatchRef.current({ text: next });
    }

    function schedule(text: string) {
        setPending(true);
        if (timerRef.current) window.clearTimeout(timerRef.current);
        timerRef.current = window.setTimeout(() => flush(text), SAVE_MS);
    }

    useEffect(
        () => () => {
            if (timerRef.current) window.clearTimeout(timerRef.current);
            const next = draftRef.current.slice(0, NOTES_MAX);
            if (next !== savedRef.current) onPatchRef.current({ text: next });
        },
        []
    );

    const remaining = NOTES_MAX - draft.length;
    const status = pending ? "Saving" : draft === saved ? "Saved" : "Unsaved";

    return (
        <div className="flex h-full min-h-0 flex-col">
            <div className="flex items-center justify-between gap-2 px-3 pt-2">
                <p className="text-[11px] text-muted-foreground">
                    {remaining < 400 ? `${remaining} left` : "Research notes"}
                </p>
                <LiveStatusBadge label={status} tone={pending ? "cached" : "idle"} />
            </div>
            <textarea
                aria-label="Research notes"
                className="min-h-0 flex-1 resize-none bg-transparent px-3 py-2 text-sm leading-6 text-foreground outline-none placeholder:text-muted-foreground"
                maxLength={NOTES_MAX}
                onBlur={() => {
                    setFocused(false);
                    flush(draft);
                }}
                onChange={(event) => {
                    const next = event.target.value.slice(0, NOTES_MAX);
                    setDraft(next);
                    schedule(next);
                }}
                onClick={(event) => event.stopPropagation()}
                onFocus={() => setFocused(true)}
                onKeyDown={(event) => event.stopPropagation()}
                onPointerDown={(event) => event.stopPropagation()}
                placeholder="Type research notes. Chat can update this too — your typing autosaves."
                spellCheck
                value={draft}
            />
        </div>
    );
}
