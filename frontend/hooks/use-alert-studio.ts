"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useOptionalAdaptiveDeskPrefs } from "@/components/adaptive-workspace/desk-prefs";
import {
    createAdaptiveAlertStudioDraft,
    deployAdaptiveAlertStudio,
    getAdaptiveAlertStudio,
    putAdaptiveWorkspacePreference,
    refreshAdaptiveAlertStudio
} from "@/service/actions/adaptive-workspace";
import type { AdaptiveAlertStudio, WorkspaceComponent } from "@/service/types/adaptive-workspace";

function stringValue(value: unknown): string {
    return typeof value === "string" ? value.trim() : "";
}

export function resolveStudioWorkflowId(component: WorkspaceComponent, defaultWorkflowId?: string): string {
    const params = component.data?.params ?? {};
    return (
        stringValue(params.workflow_id) ||
        stringValue(component.props?.workflowId) ||
        stringValue(defaultWorkflowId) ||
        ""
    );
}

export function useAlertStudio(component: WorkspaceComponent, refreshNonce: number) {
    const prefs = useOptionalAdaptiveDeskPrefs();
    const workflowId = resolveStudioWorkflowId(component, prefs?.defaultWorkflowId);
    const snapshotId = stringValue(component.data?.params?.snapshot_id) || stringValue(component.props?.snapshotId);
    const [studio, setStudio] = useState<AdaptiveAlertStudio | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [loading, setLoading] = useState(true);
    const [busy, setBusy] = useState(false);

    const load = useCallback(async () => {
        try {
            const next = await getAdaptiveAlertStudio({
                snapshotId: snapshotId || undefined,
                workflowId: workflowId || undefined
            });
            setStudio(next);
            setError(null);
        } catch (caught) {
            setError(caught instanceof Error ? caught.message : "Could not load alert studio.");
        } finally {
            setLoading(false);
        }
    }, [snapshotId, workflowId]);

    useEffect(() => {
        setLoading(true);
        void load();
    }, [load, refreshNonce]);

    const selectWorkflow = useCallback(
        async (nextId: string, onPatch?: (props: Record<string, unknown>) => void) => {
            onPatch?.({ workflowId: nextId });
            await putAdaptiveWorkspacePreference("default_workflow_id", nextId);
            await prefs?.reload();
        },
        [prefs]
    );

    const refresh = useCallback(async () => {
        setBusy(true);
        try {
            const next = await refreshAdaptiveAlertStudio(studio?.workflow_id || workflowId || undefined);
            setStudio(next);
            setError(null);
            return next;
        } catch (caught) {
            const message = caught instanceof Error ? caught.message : "Could not refresh snapshot.";
            setError(message);
            throw caught;
        } finally {
            setBusy(false);
        }
    }, [studio?.workflow_id, workflowId]);

    const deploy = useCallback(
        async (confirm: boolean) => {
            const id = studio?.snapshot_id;
            if (!id) {
                throw new Error("Refresh a snapshot before deploying.");
            }
            setBusy(true);
            try {
                const next = await deployAdaptiveAlertStudio(id, confirm);
                setStudio(next);
                setError(null);
                return next;
            } catch (caught) {
                const message = caught instanceof Error ? caught.message : "Could not deploy snapshot.";
                setError(message);
                throw caught;
            } finally {
                setBusy(false);
            }
        },
        [studio?.snapshot_id]
    );

    const createDraft = useCallback(
        async (payload: { field?: string; name?: string; operator?: string; symbol: string; value: number }) => {
            setBusy(true);
            try {
                const next = await createAdaptiveAlertStudioDraft(payload);
                setStudio(next);
                setError(null);
                if (next.workflow_id) {
                    await putAdaptiveWorkspacePreference("default_workflow_id", next.workflow_id);
                    await prefs?.reload();
                }
                return next;
            } catch (caught) {
                const message = caught instanceof Error ? caught.message : "Could not create alert draft.";
                setError(message);
                throw caught;
            } finally {
                setBusy(false);
            }
        },
        [prefs]
    );

    return useMemo(
        () => ({ busy, createDraft, deploy, error, loading, refresh, reload: load, selectWorkflow, studio, workflowId }),
        [busy, createDraft, deploy, error, load, loading, refresh, selectWorkflow, studio, workflowId]
    );
}
