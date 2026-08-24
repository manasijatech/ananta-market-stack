"use client";

import { useCallback, useEffect, useState } from "react";
import {
    IconBookmark,
    IconLayoutGrid,
    IconSparkles,
    IconTrash,
    IconWand
} from "@tabler/icons-react";
import { useAdaptiveDeskPrefs } from "@/components/adaptive-workspace/desk-prefs";
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
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuLabel,
    DropdownMenuSeparator,
    DropdownMenuTrigger
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SimpleSelect } from "@/components/ui/simple-select";
import { useDeskWatchlists } from "@/hooks/use-desk-data";
import {
    applyAdaptiveWorkspaceDesk,
    applyAdaptiveWorkspaceSkill,
    applyAdaptiveWorkspaceTemplate,
    deleteAdaptiveWorkspaceDesk,
    deleteAdaptiveWorkspacePreference,
    listAdaptiveWorkspaceDesks,
    listAdaptiveWorkspaceSkills,
    listAdaptiveWorkspaceSuggestions,
    listAdaptiveWorkspaceTemplates,
    putAdaptiveWorkspacePreference,
    saveAdaptiveWorkspaceDesk
} from "@/service/actions/adaptive-workspace";
import { getAlertWorkflows } from "@/service/actions/alerts";
import type {
    AdaptiveWorkspaceCatalogItem,
    AdaptiveWorkspaceSavedDesk,
    AdaptiveWorkspaceSuggestion
} from "@/service/types/adaptive-workspace";
import type { AlertWorkflow } from "@/service/types/alerts";

type PendingApply = {
    confirm: string;
    kind: "desk" | "skill" | "template";
    id: string;
    title: string;
};

function suggestionLabel(
    item: AdaptiveWorkspaceSuggestion,
    templates: AdaptiveWorkspaceCatalogItem[],
    skills: AdaptiveWorkspaceCatalogItem[]
) {
    if (item.label?.trim()) return item.label.trim();
    const pool = item.kind === "skill" ? skills : templates;
    return pool.find((entry) => entry.id === item.target_id)?.label ?? item.target_id;
}

export function AdaptiveDeskPersonalization() {
    const canvas = useAdaptiveWorkspace();
    const prefs = useAdaptiveDeskPrefs();
    const { watchlists } = useDeskWatchlists();
    const [templates, setTemplates] = useState<AdaptiveWorkspaceCatalogItem[]>([]);
    const [skills, setSkills] = useState<AdaptiveWorkspaceCatalogItem[]>([]);
    const [desks, setDesks] = useState<AdaptiveWorkspaceSavedDesk[]>([]);
    const [suggestions, setSuggestions] = useState<AdaptiveWorkspaceSuggestion[]>([]);
    const [workflows, setWorkflows] = useState<AlertWorkflow[]>([]);
    const [saveOpen, setSaveOpen] = useState(false);
    const [prefsOpen, setPrefsOpen] = useState(false);
    const [deskName, setDeskName] = useState("");
    const [pending, setPending] = useState<PendingApply | null>(null);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const reloadLists = useCallback(async () => {
        const [nextTemplates, nextSkills, nextDesks, nextSuggestions, nextWorkflows] = await Promise.allSettled([
            listAdaptiveWorkspaceTemplates(),
            listAdaptiveWorkspaceSkills(),
            listAdaptiveWorkspaceDesks(),
            listAdaptiveWorkspaceSuggestions(),
            getAlertWorkflows()
        ]);
        if (nextTemplates.status === "fulfilled") setTemplates(nextTemplates.value);
        if (nextSkills.status === "fulfilled") setSkills(nextSkills.value);
        if (nextDesks.status === "fulfilled") setDesks(nextDesks.value);
        if (nextSuggestions.status === "fulfilled") setSuggestions(nextSuggestions.value);
        if (nextWorkflows.status === "fulfilled") setWorkflows(nextWorkflows.value);
    }, []);

    useEffect(() => {
        void reloadLists();
    }, [reloadLists, canvas.sessionId]);

    async function applyCurrent(kind: PendingApply["kind"], id: string) {
        const sessionId = canvas.sessionId;
        if (!sessionId) {
            setError("Start a desk conversation first, then apply a layout.");
            return;
        }
        setBusy(true);
        setError(null);
        try {
            const current =
                kind === "template"
                    ? await applyAdaptiveWorkspaceTemplate(id, sessionId)
                    : kind === "skill"
                      ? await applyAdaptiveWorkspaceSkill(id, sessionId)
                      : await applyAdaptiveWorkspaceDesk(id, sessionId);
            if (canvas.sessionId !== sessionId) {
                setPending(null);
                return;
            }
            const parsed = parseWorkspaceSpec(current.spec);
            if (parsed) canvas.applySpec(parsed, "user", sessionId);
            setPending(null);
            await reloadLists();
        } catch (caught) {
            setError(caught instanceof Error ? caught.message : "Could not apply that desk.");
        } finally {
            setBusy(false);
        }
    }

    async function saveDesk() {
        const name = deskName.trim();
        if (!name) return;
        setBusy(true);
        setError(null);
        try {
            await saveAdaptiveWorkspaceDesk(name, canvas.spec);
            setSaveOpen(false);
            setDeskName("");
            await reloadLists();
        } catch (caught) {
            setError(caught instanceof Error ? caught.message : "Could not save this desk.");
        } finally {
            setBusy(false);
        }
    }

    return (
        <div className="flex min-w-0 flex-wrap items-center justify-end gap-1.5">
            {suggestions.length ? (
                <DropdownMenu onOpenChange={(open) => open && void reloadLists()}>
                    <DropdownMenuTrigger
                        className="inline-flex h-7 items-center gap-1 rounded-md border border-border bg-background px-2 text-xs font-semibold"
                        type="button"
                    >
                        <IconSparkles className="size-3.5" stroke={1.8} />
                        Suggest
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-80">
                        <DropdownMenuLabel>Based on what you keep asking</DropdownMenuLabel>
                        <p className="px-2 pb-1 text-[11px] leading-4 text-muted-foreground">
                            Applies only to this desk. Other conversations keep their canvas.
                        </p>
                        {suggestions.map((item) => {
                            const label = suggestionLabel(item, templates, skills);
                            return (
                                <DropdownMenuItem
                                    key={item.id}
                                    onSelect={() =>
                                        setPending({
                                            confirm: `${item.message} This replaces the current canvas on this desk only.`,
                                            id: item.target_id,
                                            kind: item.kind === "skill" ? "skill" : "template",
                                            title: label
                                        })
                                    }
                                >
                                    <span className="min-w-0">
                                        <span className="block font-semibold">{label}</span>
                                        <span className="block text-[11px] font-normal text-muted-foreground">{item.message}</span>
                                    </span>
                                </DropdownMenuItem>
                            );
                        })}
                    </DropdownMenuContent>
                </DropdownMenu>
            ) : null}
            <DropdownMenu onOpenChange={(open) => open && void reloadLists()}>
                <DropdownMenuTrigger
                    className="inline-flex h-7 items-center gap-1 rounded-md border border-border bg-background px-2 text-xs font-semibold"
                    type="button"
                >
                    <IconLayoutGrid className="size-3.5" stroke={1.8} />
                    Templates
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-72">
                    <DropdownMenuLabel>Apply a template</DropdownMenuLabel>
                    {templates.length ? (
                        templates.map((item) => (
                            <DropdownMenuItem
                                key={item.id}
                                onSelect={() =>
                                    setPending({
                                        confirm: `Replace this canvas with the ${item.label} template? This does not happen automatically.`,
                                        id: item.id,
                                        kind: "template",
                                        title: item.label
                                    })
                                }
                            >
                                <span className="min-w-0">
                                    <span className="block font-semibold">{item.label}</span>
                                    <span className="block text-[11px] font-normal text-muted-foreground">{item.description}</span>
                                </span>
                            </DropdownMenuItem>
                        ))
                    ) : (
                        <p className="px-2 py-2 text-xs text-muted-foreground">Templates are still loading.</p>
                    )}
                    <DropdownMenuSeparator />
                    <DropdownMenuLabel>Desk skills</DropdownMenuLabel>
                    {skills.length ? (
                        skills.map((item) => (
                            <DropdownMenuItem
                                key={item.id}
                                onSelect={() =>
                                    setPending({
                                        confirm: `Apply the ${item.label} skill to this canvas?`,
                                        id: item.id,
                                        kind: "skill",
                                        title: item.label
                                    })
                                }
                            >
                                <IconWand className="size-4" stroke={1.8} />
                                <span className="min-w-0">
                                    <span className="block font-semibold">{item.label}</span>
                                    <span className="block text-[11px] font-normal text-muted-foreground">{item.description}</span>
                                </span>
                            </DropdownMenuItem>
                        ))
                    ) : (
                        <p className="px-2 py-2 text-xs text-muted-foreground">Skills are still loading.</p>
                    )}
                </DropdownMenuContent>
            </DropdownMenu>
            <DropdownMenu onOpenChange={(open) => open && void reloadLists()}>
                <DropdownMenuTrigger
                    className="inline-flex h-7 items-center gap-1 rounded-md border border-border bg-background px-2 text-xs font-semibold"
                    type="button"
                >
                    <IconBookmark className="size-3.5" stroke={1.8} />
                    Saved
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-72">
                    <DropdownMenuItem
                        onSelect={() => {
                            setDeskName(canvas.spec.title || "Named desk");
                            setSaveOpen(true);
                        }}
                    >
                        Save current desk as…
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    {desks.length ? (
                        desks.map((desk) => (
                            <div className="flex items-center gap-1 pr-1" key={desk.id}>
                                <DropdownMenuItem
                                    className="min-w-0 flex-1"
                                    onSelect={() =>
                                        setPending({
                                            confirm: `Load “${desk.name}” onto this canvas?`,
                                            id: desk.id,
                                            kind: "desk",
                                            title: desk.name
                                        })
                                    }
                                >
                                    {desk.name}
                                </DropdownMenuItem>
                                <Button
                                    aria-label={`Delete ${desk.name}`}
                                    className="size-7 shrink-0 text-muted-foreground hover:text-destructive"
                                    onClick={(event) => {
                                        event.preventDefault();
                                        event.stopPropagation();
                                        void deleteAdaptiveWorkspaceDesk(desk.id).then(() => reloadLists());
                                    }}
                                    size="icon"
                                    type="button"
                                    variant="ghost"
                                >
                                    <IconTrash className="size-3.5" stroke={1.8} />
                                </Button>
                            </div>
                        ))
                    ) : (
                        <p className="px-2 py-2 text-xs text-muted-foreground">No named desks yet.</p>
                    )}
                </DropdownMenuContent>
            </DropdownMenu>
            <Button onClick={() => setPrefsOpen(true)} size="xs" type="button" variant="ghost">
                Prefs
            </Button>

            {error ? <p className="w-full text-right text-xs text-destructive">{error}</p> : null}

            <Dialog onOpenChange={setSaveOpen} open={saveOpen}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>Save named desk</DialogTitle>
                        <DialogDescription>Stores this layout so you can load it later. Chat history stays on this session.</DialogDescription>
                    </DialogHeader>
                    <div className="px-6 pb-2">
                        <Label className="text-sm">Name</Label>
                        <Input className="mt-2" onChange={(event) => setDeskName(event.target.value)} value={deskName} />
                    </div>
                    <DialogFooter>
                        <Button onClick={() => setSaveOpen(false)} type="button" variant="outline">
                            Cancel
                        </Button>
                        <Button disabled={busy || !deskName.trim()} onClick={() => void saveDesk()} type="button">
                            Save desk
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            <Dialog onOpenChange={(open) => !open && setPending(null)} open={Boolean(pending)}>
                <DialogContent className="h-fit max-h-[min(24rem,calc(100dvh-2rem))] overflow-hidden">
                    <DialogHeader>
                        <DialogTitle>{pending?.title ?? "Apply layout"}</DialogTitle>
                        <DialogDescription>{pending?.confirm}</DialogDescription>
                    </DialogHeader>
                    <DialogFooter>
                        <Button onClick={() => setPending(null)} type="button" variant="outline">
                            Keep current
                        </Button>
                        <Button
                            disabled={busy || !pending}
                            onClick={() => pending && void applyCurrent(pending.kind, pending.id)}
                            type="button"
                        >
                            Apply
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            <Dialog onOpenChange={setPrefsOpen} open={prefsOpen}>
                <DialogContent className="flex h-fit max-h-[min(36rem,calc(100dvh-2rem))] flex-col overflow-hidden">
                    <DialogHeader>
                        <DialogTitle>Display preferences</DialogTitle>
                        <DialogDescription>These are inspectable and deletable. Nothing here rearranges the canvas by itself.</DialogDescription>
                    </DialogHeader>
                    <div className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto px-6 pb-2">
                    <div className="grid gap-3">
                        <div className="grid gap-1.5">
                            <Label>Density</Label>
                            <SimpleSelect
                                onValueChange={(value) =>
                                    void putAdaptiveWorkspacePreference("density", value).then(() => prefs.reload())
                                }
                                options={[
                                    { label: "Comfortable", value: "comfortable" },
                                    { label: "Compact", value: "compact" }
                                ]}
                                size="sm"
                                value={prefs.density}
                            />
                        </div>
                        <div className="grid gap-1.5">
                            <Label>Default watchlist</Label>
                            <SimpleSelect
                                onValueChange={(value) =>
                                    void putAdaptiveWorkspacePreference("default_watchlist_id", value).then(() => prefs.reload())
                                }
                                options={[
                                    { label: "Latest watchlist", value: "" },
                                    ...watchlists.map((item) => ({ label: item.name, value: item.id }))
                                ]}
                                placeholder="Latest watchlist"
                                size="sm"
                                value={prefs.defaultWatchlistId}
                            />
                        </div>
                        <div className="grid gap-1.5">
                            <Label>Default alert workflow</Label>
                            <SimpleSelect
                                onValueChange={(value) =>
                                    void putAdaptiveWorkspacePreference("default_workflow_id", value).then(() => prefs.reload())
                                }
                                options={[
                                    { label: "Latest workflow", value: "" },
                                    ...workflows.map((item) => ({
                                        label: `${item.name}${item.status ? ` (${item.status})` : ""}`,
                                        value: item.id
                                    }))
                                ]}
                                placeholder="Latest workflow"
                                size="sm"
                                value={prefs.defaultWorkflowId}
                            />
                        </div>
                        <div className="grid gap-1.5">
                            <Label>Default intel product</Label>
                            <SimpleSelect
                                onValueChange={(value) =>
                                    void putAdaptiveWorkspacePreference("intel_product", value).then(() => prefs.reload())
                                }
                                options={[
                                    { label: "News", value: "news" },
                                    { label: "Announcements", value: "announcements" },
                                    { label: "Earnings", value: "earnings" },
                                    { label: "Concalls", value: "concalls" }
                                ]}
                                size="sm"
                                value={prefs.intelProduct || "news"}
                            />
                        </div>
                        {prefs.items.filter((item) => item.key !== "canvas_locked").length ? (
                            <div className="grid gap-1">
                                <p className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">Saved keys</p>
                                {prefs.items.filter((item) => item.key !== "canvas_locked").map((item) => (
                                    <div className="flex min-w-0 items-start justify-between gap-2 rounded-md border border-border px-2 py-1.5" key={item.key}>
                                        <span className="min-w-0 text-sm">
                                            <span className="font-semibold">{item.key}</span>
                                            <span className="block max-h-16 overflow-hidden break-all text-muted-foreground">
                                                = {typeof item.value === "string" ? item.value : JSON.stringify(item.value)}
                                            </span>
                                        </span>
                                        {item.deletable ? (
                                            <Button
                                                onClick={() =>
                                                    void deleteAdaptiveWorkspacePreference(item.key).then(() => prefs.reload())
                                                }
                                                size="xs"
                                                type="button"
                                                variant="ghost"
                                            >
                                                Delete
                                            </Button>
                                        ) : null}
                                    </div>
                                ))}
                            </div>
                        ) : (
                            <p className="text-sm text-muted-foreground">No saved preferences yet.</p>
                        )}
                    </div>
                    </div>
                    <DialogFooter>
                        <Button onClick={() => setPrefsOpen(false)} type="button" variant="outline">
                            Close
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    );
}
