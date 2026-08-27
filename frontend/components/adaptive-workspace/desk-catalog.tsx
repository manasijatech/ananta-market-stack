"use client";

import { useCallback, useEffect, useState } from "react";
import { useAdaptiveWorkspace } from "@/components/adaptive-workspace/workspace-provider";
import { parseWorkspaceSpec } from "@/lib/adaptive-workspace/spec";
import { Button } from "@/components/ui/button";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle
} from "@/components/ui/dialog";
import {
    applyAdaptiveWorkspaceDesk,
    applyAdaptiveWorkspaceSkill,
    applyAdaptiveWorkspaceTemplate,
    listAdaptiveWorkspaceSkills,
    listAdaptiveWorkspaceTemplates
} from "@/service/actions/adaptive-workspace";
import type { AdaptiveWorkspaceCatalogItem } from "@/service/types/adaptive-workspace";

export type DeskCatalogKind = "desk" | "skill" | "template";

export type PendingDeskCatalogApply = {
    confirm: string;
    id: string;
    kind: DeskCatalogKind;
    title: string;
};

export function deskCatalogConfirm(kind: DeskCatalogKind, title: string): string {
    if (kind === "template") {
        return `Replace this canvas with the ${title} template? This does not happen automatically.`;
    }
    if (kind === "skill") {
        return `Apply the ${title} skill to this canvas?`;
    }
    return `Load “${title}” onto this canvas?`;
}

export function pendingCatalogApply(
    kind: Exclude<DeskCatalogKind, "desk">,
    item: AdaptiveWorkspaceCatalogItem
): PendingDeskCatalogApply {
    return {
        confirm: deskCatalogConfirm(kind, item.label),
        id: item.id,
        kind,
        title: item.label
    };
}

export async function applyDeskCatalogItem(kind: DeskCatalogKind, id: string, sessionId: string) {
    if (kind === "template") return applyAdaptiveWorkspaceTemplate(id, sessionId);
    if (kind === "skill") return applyAdaptiveWorkspaceSkill(id, sessionId);
    return applyAdaptiveWorkspaceDesk(id, sessionId);
}

export function useDeskCatalogApply() {
    const canvas = useAdaptiveWorkspace();
    const [pending, setPending] = useState<PendingDeskCatalogApply | null>(null);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const applyPending = useCallback(async () => {
        if (!pending) return;
        const sessionId = canvas.sessionId;
        if (!sessionId) {
            setError("Start a desk conversation first, then apply a layout.");
            return;
        }
        setBusy(true);
        setError(null);
        try {
            const current = await applyDeskCatalogItem(pending.kind, pending.id, sessionId);
            if (canvas.sessionId !== sessionId) {
                setPending(null);
                return;
            }
            const parsed = parseWorkspaceSpec(current.spec);
            if (parsed) canvas.applySpec(parsed, "user", sessionId);
            setPending(null);
        } catch (caught) {
            setError(caught instanceof Error ? caught.message : "Could not apply that desk.");
        } finally {
            setBusy(false);
        }
    }, [canvas, pending]);

    return { applyPending, busy, error, pending, setError, setPending };
}

export function DeskCatalogConfirmDialog({
    busy,
    onApply,
    onCancel,
    pending
}: {
    busy: boolean;
    onApply: () => void;
    onCancel: () => void;
    pending: PendingDeskCatalogApply | null;
}) {
    return (
        <Dialog onOpenChange={(open) => !open && onCancel()} open={Boolean(pending)}>
            <DialogContent className="h-fit max-h-[min(24rem,calc(100dvh-2rem))] overflow-hidden">
                <DialogHeader>
                    <DialogTitle>{pending?.title ?? "Apply layout"}</DialogTitle>
                    <DialogDescription>{pending?.confirm}</DialogDescription>
                </DialogHeader>
                <DialogFooter>
                    <Button onClick={onCancel} type="button" variant="outline">
                        Keep current
                    </Button>
                    <Button disabled={busy || !pending} onClick={onApply} type="button">
                        Apply
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}

export function DeskStarterCatalog() {
    const { applyPending, busy, error, pending, setPending } = useDeskCatalogApply();
    const [templates, setTemplates] = useState<AdaptiveWorkspaceCatalogItem[]>([]);
    const [skills, setSkills] = useState<AdaptiveWorkspaceCatalogItem[]>([]);

    useEffect(() => {
        let cancelled = false;
        void Promise.allSettled([listAdaptiveWorkspaceTemplates(), listAdaptiveWorkspaceSkills()]).then(
            ([nextTemplates, nextSkills]) => {
                if (cancelled) return;
                if (nextTemplates.status === "fulfilled") setTemplates(nextTemplates.value);
                if (nextSkills.status === "fulfilled") setSkills(nextSkills.value);
            }
        );
        return () => {
            cancelled = true;
        };
    }, []);

    return (
        <div className="mx-auto mt-8 w-full max-w-xl text-left">
            <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                Start from a template
            </p>
            <div className="mt-2 flex flex-wrap gap-1.5">
                {templates.length ? (
                    templates.map((item) => (
                        <button
                            className="rounded-md border border-border bg-background px-2.5 py-1.5 text-left text-xs font-semibold transition hover:border-primary hover:bg-[var(--accent-glow)] hover:text-primary"
                            key={item.id}
                            onClick={() => setPending(pendingCatalogApply("template", item))}
                            type="button"
                        >
                            {item.label}
                        </button>
                    ))
                ) : (
                    <p className="text-xs text-muted-foreground">Templates are still loading.</p>
                )}
            </div>
            <p className="mt-4 text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                Apply a skill
            </p>
            <div className="mt-2 flex flex-wrap gap-1.5">
                {skills.length ? (
                    skills.map((item) => (
                        <button
                            className="rounded-md border border-border bg-background px-2.5 py-1.5 text-left text-xs font-semibold transition hover:border-primary hover:bg-[var(--accent-glow)] hover:text-primary"
                            key={item.id}
                            onClick={() => setPending(pendingCatalogApply("skill", item))}
                            type="button"
                        >
                            {item.label}
                        </button>
                    ))
                ) : (
                    <p className="text-xs text-muted-foreground">Skills are still loading.</p>
                )}
            </div>
            <p className="mt-2 text-[11px] text-muted-foreground">
                Templates and skills replace this canvas only after you confirm. They never apply automatically.
            </p>
            {error ? <p className="mt-2 text-xs text-destructive">{error}</p> : null}
            <DeskCatalogConfirmDialog
                busy={busy}
                onApply={() => void applyPending()}
                onCancel={() => setPending(null)}
                pending={pending}
            />
        </div>
    );
}
