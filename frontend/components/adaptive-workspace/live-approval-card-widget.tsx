"use client";

import { useState } from "react";
import { LiveStatusBadge, WidgetState } from "@/components/adaptive-workspace/widget-kit";
import { Button } from "@/components/ui/button";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle
} from "@/components/ui/dialog";
import { isRecord } from "@/lib/adaptive-workspace/tool-envelope";
import { useAlertStudio } from "@/hooks/use-alert-studio";
import type { WorkspaceComponent } from "@/service/types/adaptive-workspace";

type Props = {
    component: WorkspaceComponent;
    refreshNonce: number;
};

function errorList(validation: Record<string, unknown>): string[] {
    return Array.isArray(validation.errors)
        ? validation.errors.filter((item): item is string => typeof item === "string")
        : [];
}

function diffSummary(diff: Record<string, unknown>): string {
    const keys = Object.keys(diff);
    if (!keys.length) return "No diff against the previous snapshot.";
    return keys.slice(0, 8).join(", ");
}

export function LiveApprovalCardWidget({ component, refreshNonce }: Props) {
    const { busy, deploy, error, loading, refresh, studio } = useAlertStudio(component, refreshNonce);
    const [confirmOpen, setConfirmOpen] = useState(false);
    const errors = errorList(studio?.validation ?? {});
    const hasSnapshot = Boolean(studio?.snapshot_id);
    const canDeploy = hasSnapshot && studio?.valid === true;
    const canPrepare = Boolean(studio?.workflow_id);

    return (
        <WidgetState error={error} loading={loading} loadingLabel="Loading approval">
            <div className="flex items-center justify-between gap-2 px-3 pt-2">
                <p className="text-xs text-muted-foreground">
                    {canDeploy ? "Valid snapshot" : hasSnapshot ? "Not ready to deploy" : "Snapshot not prepared"}
                </p>
                <LiveStatusBadge
                    label={canDeploy ? "Valid" : hasSnapshot ? "Blocked" : "Draft"}
                    tone={canDeploy ? "live" : hasSnapshot ? "error" : "idle"}
                />
            </div>
            <div className="grid gap-2 p-3">
                {errors.length ? (
                    <ul className="list-disc space-y-1 pl-4 text-xs text-destructive">
                        {errors.map((item) => (
                            <li key={item}>{item}</li>
                        ))}
                    </ul>
                ) : (
                    <p className="text-xs text-muted-foreground">{diffSummary(studio?.diff ?? {})}</p>
                )}
                {isRecord(studio?.explanation) && typeof studio.explanation.summary === "string" ? (
                    <p className="text-xs text-muted-foreground">{studio.explanation.summary}</p>
                ) : null}
                {!hasSnapshot ? (
                    <p className="text-xs text-muted-foreground">Validate this draft, then confirm deploy.</p>
                ) : null}
                <div className="flex flex-wrap gap-2">
                    <Button
                        disabled={busy || !canPrepare}
                        onClick={() => void refresh()}
                        size="sm"
                        type="button"
                        variant={hasSnapshot ? "outline" : "default"}
                    >
                        {hasSnapshot ? "Refresh snapshot" : "Prepare snapshot"}
                    </Button>
                    <Button disabled={busy || !canDeploy} onClick={() => setConfirmOpen(true)} size="sm" type="button">
                        Deploy
                    </Button>
                </div>
            </div>
            <Dialog onOpenChange={setConfirmOpen} open={confirmOpen}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>Deploy this alert workflow?</DialogTitle>
                        <DialogDescription>
                            This applies snapshot {studio?.snapshot_id ?? ""} to {studio?.name || "the selected workflow"} and
                            sets it active. It will not run unless you confirm.
                        </DialogDescription>
                    </DialogHeader>
                    <DialogFooter>
                        <Button onClick={() => setConfirmOpen(false)} type="button" variant="outline">
                            Cancel
                        </Button>
                        <Button
                            disabled={busy || !canDeploy}
                            onClick={() => {
                                void deploy(true).then(() => setConfirmOpen(false));
                            }}
                            type="button"
                        >
                            Confirm deploy
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </WidgetState>
    );
}
