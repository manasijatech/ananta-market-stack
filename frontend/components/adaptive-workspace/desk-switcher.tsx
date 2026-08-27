"use client";

import { IconCheck, IconChevronDown, IconCopy, IconMessagePlus, IconTrash } from "@tabler/icons-react";
import { formatDate } from "@/components/brokers/ui";
import { Button } from "@/components/ui/button";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuLabel,
    DropdownMenuSeparator,
    DropdownMenuTrigger
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import type { BrokerChatSession } from "@/service/types/broker-chat";

type Props = {
    creating: boolean;
    onCreate: () => void;
    onDelete: (sessionId: string) => void;
    onDuplicate?: () => void;
    onSelect: (sessionId: string) => void;
    sessions: BrokerChatSession[];
    title: string;
};

export function AdaptiveDeskSwitcher({ creating, onCreate, onDelete, onDuplicate, onSelect, sessions, title }: Props) {
    return (
        <DropdownMenu>
            <DropdownMenuTrigger
                className={cn(
                    "inline-flex h-8 max-w-full min-w-0 items-center gap-1 rounded-md border border-border bg-background px-2 text-left text-sm font-semibold hover:bg-secondary"
                )}
                type="button"
            >
                <span className="min-w-0 truncate">{title}</span>
                <IconChevronDown className="size-3.5 shrink-0 text-muted-foreground" stroke={1.8} />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-72">
                <DropdownMenuLabel>Desks</DropdownMenuLabel>
                <DropdownMenuItem
                    disabled={creating}
                    onSelect={(event) => {
                        event.preventDefault();
                        onCreate();
                    }}
                >
                    <IconMessagePlus className="size-4" stroke={1.8} />
                    New desk
                </DropdownMenuItem>
                {onDuplicate ? (
                    <DropdownMenuItem
                        disabled={creating}
                        onSelect={(event) => {
                            event.preventDefault();
                            onDuplicate();
                        }}
                    >
                        <IconCopy className="size-4" stroke={1.8} />
                        Duplicate this desk
                    </DropdownMenuItem>
                ) : null}
                <DropdownMenuSeparator />
                {sessions.length ? (
                    sessions.map((session) => (
                        <div className="flex items-center gap-1 pr-1" key={session.id}>
                            <DropdownMenuItem className="min-w-0 flex-1" onSelect={() => onSelect(session.id)}>
                                {session.title === title ? <IconCheck className="size-3.5" stroke={1.8} /> : <span className="size-3.5" />}
                                <span className="min-w-0 flex-1">
                                    <span className="block truncate">{session.title}</span>
                                    <span className="block text-[11px] font-normal text-muted-foreground">
                                        {formatDate(session.updated_at)}
                                    </span>
                                </span>
                            </DropdownMenuItem>
                            <Button
                                aria-label={`Delete ${session.title}`}
                                className="size-7 shrink-0 text-muted-foreground hover:text-destructive"
                                onClick={(event) => {
                                    event.preventDefault();
                                    event.stopPropagation();
                                    onDelete(session.id);
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
                    <p className="px-2 py-3 text-xs text-muted-foreground">No desks yet. Start a conversation to create one.</p>
                )}
            </DropdownMenuContent>
        </DropdownMenu>
    );
}
