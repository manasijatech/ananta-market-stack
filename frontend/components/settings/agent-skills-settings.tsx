"use client";

import { useCallback, useEffect, useState } from "react";
import { IconLoader2 } from "@tabler/icons-react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { listAgentSkills, updateAgentSkillPref } from "@/service/actions/broker-chat";
import type { AgentSkillCatalogItem } from "@/service/types/broker-chat";

export function AgentSkillsSettings() {
    const [skills, setSkills] = useState<AgentSkillCatalogItem[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [busyId, setBusyId] = useState<string | null>(null);

    const reload = useCallback(async () => {
        setLoading(true);
        setError(null);
        try {
            const rows = await listAgentSkills(true);
            setSkills(rows);
        } catch (exc) {
            setError(exc instanceof Error ? exc.message : "Failed to load agent skills");
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        void reload();
    }, [reload]);

    async function toggle(skill: AgentSkillCatalogItem, enabled: boolean) {
        setBusyId(skill.id);
        setError(null);
        try {
            await updateAgentSkillPref(skill.id, { enabled });
            setSkills((current) => current.map((row) => (row.id === skill.id ? { ...row, enabled } : row)));
        } catch (exc) {
            setError(exc instanceof Error ? exc.message : "Failed to update skill");
        } finally {
            setBusyId(null);
        }
    }

    if (loading) {
        return (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <IconLoader2 className="size-4 animate-spin" stroke={1.8} />
                Loading agent skills…
            </div>
        );
    }

    return (
        <div className="grid gap-4">
            <p className="text-sm text-muted-foreground">
                Agent Skills are research playbooks. The catalog stays small in the prompt; full
                procedures load on demand. Disable a skill to hide it from Adaptive Chat.
            </p>
            {error ? <p className="text-sm text-destructive">{error}</p> : null}
            <div className="divide-y divide-border rounded-lg border border-border bg-background">
                {skills.map((skill) => (
                    <div className="flex items-start justify-between gap-4 px-4 py-3" key={skill.id}>
                        <div className="min-w-0">
                            <p className="text-sm font-semibold text-foreground">{skill.name}</p>
                            <p className="mt-1 text-xs text-muted-foreground">{skill.description}</p>
                            <p className="mt-1 font-mono text-[11px] text-muted-foreground">
                                {skill.id} · {skill.source} · v{skill.version}
                            </p>
                        </div>
                        <div className="flex shrink-0 items-center gap-2 pt-0.5">
                            {busyId === skill.id ? <IconLoader2 className="size-4 animate-spin text-muted-foreground" stroke={1.8} /> : null}
                            <Switch
                                aria-label={`Enable ${skill.name}`}
                                checked={skill.enabled}
                                disabled={busyId === skill.id}
                                onCheckedChange={(checked) => void toggle(skill, Boolean(checked))}
                            />
                        </div>
                    </div>
                ))}
            </div>
            <Button className="w-fit" onClick={() => void reload()} size="sm" type="button" variant="outline">
                Refresh
            </Button>
        </div>
    );
}
