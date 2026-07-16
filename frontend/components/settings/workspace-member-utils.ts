import type { WorkspaceMember } from "@/service/types/rbac";

const AVATAR_PALETTES = [
    "bg-blue-100 text-blue-800 dark:bg-blue-800 dark:text-blue-100",
    "bg-emerald-100 text-emerald-800 dark:bg-emerald-800 dark:text-emerald-100",
    "bg-violet-100 text-violet-800 dark:bg-violet-800 dark:text-violet-100",
    "bg-amber-100 text-amber-800 dark:bg-amber-800 dark:text-amber-100",
    "bg-rose-100 text-rose-800 dark:bg-rose-800 dark:text-rose-100"
] as const;

export function memberLabel(member: WorkspaceMember): string {
    return member.display_name || member.auth_name || member.email || "Unnamed member";
}

export function memberSubtitle(member: WorkspaceMember): string {
    if (member.email) {
        return member.email;
    }
    if (member.auth_name && member.auth_name !== memberLabel(member)) {
        return member.auth_name;
    }
    return member.user_id;
}

export function memberInitials(member: WorkspaceMember): string {
    const label = memberLabel(member);
    const parts = label.split(/\s+/).filter(Boolean);
    if (parts.length >= 2) {
        return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
    }
    return label.slice(0, 2).toUpperCase();
}

export function memberAvatarClass(seed: string): string {
    let hash = 0;
    for (let index = 0; index < seed.length; index += 1) {
        hash = (hash + seed.charCodeAt(index) * (index + 1)) % AVATAR_PALETTES.length;
    }
    return AVATAR_PALETTES[hash];
}

export function sentenceCase(value: string): string {
    if (!value) {
        return value;
    }
    return value.charAt(0).toUpperCase() + value.slice(1).toLowerCase();
}

export function roleDisplayLabel(roleName: string, fallback?: string): string {
    if (roleName === "operator") {
        return "Editor / Member";
    }
    if (roleName === "admin") {
        return "Admin";
    }
    if (roleName === "viewer") {
        return "Viewer";
    }
    return fallback || sentenceCase(roleName);
}
