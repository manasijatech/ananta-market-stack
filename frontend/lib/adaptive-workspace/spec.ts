import {
    ADAPTIVE_COMPONENT_TYPES,
    ALLOWED_ACTIONS,
    ALLOWED_DATA_TOOLS,
    GRID_COLUMNS,
    MICRO_APP_IDS,
    type WorkspaceSpec,
    type WorkspaceSpecIssue
} from "@/service/types/adaptive-workspace";
import { packComponentPositions } from "@/lib/adaptive-workspace/layout";
import { isRecord, unwrapToolOutput } from "@/lib/adaptive-workspace/tool-envelope";

const FORBIDDEN_PROP_KEYS = new Set([
    "class",
    "classname",
    "className",
    "style",
    "css",
    "dangerouslysetinnerhtml",
    "innerhtml",
    "jsx",
    "children",
    "href",
    "src",
    "onclick"
]);

const HTML_ARTIFACT_DOCUMENT_MAX = 60000;
const HTML_ARTIFACT_IFRAME_RE = /<iframe\b/i;
const HTML_ARTIFACT_JS_URL_RE = /javascript\s*:/i;
const HTML_ARTIFACT_META_HTTP_EQUIV_RE = /<meta\b[^>]*\bhttp-equiv\b/i;
const HTML_ARTIFACT_REMOTE_SCRIPT_RE = /<script\b[^>]*\bsrc\s*=\s*['"]?\s*https?:\/\//i;
const HTML_ARTIFACT_REMOTE_LINK_RE = /<link\b[^>]*\bhref\s*=\s*['"]?\s*https?:\/\//i;
const HTML_ARTIFACT_REMOTE_IMG_RE = /<img\b[^>]*\bsrc\s*=\s*['"]?\s*https?:\/\//i;

function htmlArtifactDocumentIssues(document: string): string[] {
    const issues: string[] = [];
    if (!document.trim()) {
        issues.push("document must be a non-empty string");
        return issues;
    }
    if (document.length > HTML_ARTIFACT_DOCUMENT_MAX) {
        issues.push(`document must be at most ${HTML_ARTIFACT_DOCUMENT_MAX} characters`);
    }
    if (HTML_ARTIFACT_IFRAME_RE.test(document)) {
        issues.push("document must not include iframe elements");
    }
    if (HTML_ARTIFACT_JS_URL_RE.test(document)) {
        issues.push("document must not include javascript: URLs");
    }
    if (HTML_ARTIFACT_META_HTTP_EQUIV_RE.test(document)) {
        issues.push("document must not include meta http-equiv tags");
    }
    if (HTML_ARTIFACT_REMOTE_SCRIPT_RE.test(document)) {
        issues.push("document must not include remote script src URLs");
    }
    if (HTML_ARTIFACT_REMOTE_LINK_RE.test(document)) {
        issues.push("document must not include remote link href URLs");
    }
    if (HTML_ARTIFACT_REMOTE_IMG_RE.test(document)) {
        issues.push("document must not include remote img src URLs");
    }
    return issues;
}

const ID_PATTERN = /^[a-z][a-z0-9-]*$/;
const SECRET_PARAM_KEYS = new Set(["api_key", "password", "pin", "totp", "secret", "token", "access_token"]);

function issue(path: string, message: string): WorkspaceSpecIssue {
    return { path, message };
}

export function validateWorkspaceSpec(payload: unknown): WorkspaceSpecIssue[] {
    const issues: WorkspaceSpecIssue[] = [];
    if (!isRecord(payload)) {
        return [issue("", "WorkspaceSpec must be an object")];
    }
    if (payload.version !== "1") {
        issues.push(issue("version", "only version 1 is supported"));
    }
    if (typeof payload.title !== "string" || !payload.title.trim() || payload.title.length > 120) {
        issues.push(issue("title", "title must be a non-empty string up to 120 characters"));
    }
    const layout = isRecord(payload.layout) ? payload.layout : {};
    if (layout.mode !== "grid" || layout.columns !== GRID_COLUMNS) {
        issues.push(issue("layout", "layout must be a 12-column grid"));
    }
    if (!Array.isArray(payload.components)) {
        issues.push(issue("components", "components must be an array"));
        return issues;
    }
    if (payload.universe != null) {
        if (!isRecord(payload.universe) || !Array.isArray(payload.universe.symbols)) {
            issues.push(issue("universe", "universe.symbols must be a list of symbols"));
        } else if (payload.universe.symbols.some((item) => typeof item !== "string")) {
            issues.push(issue("universe.symbols", "universe.symbols must be strings"));
        }
    }
    const ids = new Set<string>();
    payload.components.forEach((item, index) => {
        const path = `components.${index}`;
        if (!isRecord(item)) {
            issues.push(issue(path, "component must be an object"));
            return;
        }
        if (typeof item.id !== "string" || !ID_PATTERN.test(item.id)) {
            issues.push(issue(`${path}.id`, "id must match ^[a-z][a-z0-9-]*$"));
        } else if (ids.has(item.id)) {
            issues.push(issue(`${path}.id`, "component ids must be unique"));
        } else {
            ids.add(item.id);
        }
        if (!ADAPTIVE_COMPONENT_TYPES.includes(item.type as (typeof ADAPTIVE_COMPONENT_TYPES)[number])) {
            issues.push(issue(`${path}.type`, `component type ${String(item.type)} is not in the catalog`));
        }
        const position = isRecord(item.position) ? item.position : {};
        const x = Number(position.x);
        const y = Number(position.y);
        const w = Number(position.w);
        const h = Number(position.h);
        if (![x, y, w, h].every(Number.isFinite) || x < 0 || y < 0 || w < 1 || h < 1 || x + w > GRID_COLUMNS) {
            issues.push(issue(`${path}.position`, "position must fit the 12-column grid"));
        }
        if (item.data != null) {
            if (!isRecord(item.data) || typeof item.data.tool !== "string") {
                issues.push(issue(`${path}.data`, "data.tool is required"));
            } else if (!ALLOWED_DATA_TOOLS.includes(item.data.tool as (typeof ALLOWED_DATA_TOOLS)[number])) {
                issues.push(issue(`${path}.data.tool`, `data tool ${item.data.tool} is not allowlisted`));
            }
            const params = isRecord(item.data) && isRecord(item.data.params) ? item.data.params : {};
            const blocked = Object.keys(params).filter((key) => SECRET_PARAM_KEYS.has(key.toLowerCase()));
            if (blocked.length) {
                issues.push(issue(`${path}.data.params`, `data params must not include ${blocked.join(", ")}`));
            }
        }
        if (item.type === "html-artifact") {
            if (item.data == null || !isRecord(item.data)) {
                issues.push(issue(`${path}.data`, "html-artifact requires data with params.document"));
            } else {
                if (item.data.tool !== "workspace_publish_html_artifact") {
                    issues.push(issue(`${path}.data.tool`, "html-artifact data.tool must be workspace_publish_html_artifact"));
                }
                const params = isRecord(item.data.params) ? item.data.params : {};
                const document = typeof params.document === "string" ? params.document : "";
                const docIssues = htmlArtifactDocumentIssues(document);
                for (const message of docIssues) {
                    issues.push(issue(`${path}.data.params.document`, message));
                }
            }
            const props = isRecord(item.props) ? item.props : {};
            const title = props.title;
            if (title != null && (typeof title !== "string" || !title.trim() || title.length > 120)) {
                issues.push(issue(`${path}.props.title`, "title must be a non-empty string up to 120 characters"));
            }
        }
        if (item.type !== "html-artifact" && item.data != null && isRecord(item.data) && isRecord(item.data.params) && "document" in item.data.params) {
            issues.push(issue(`${path}.data.params.document`, "document is only allowed on html-artifact widgets"));
        }
        if (item.type === "micro-app") {
            const props = isRecord(item.props) ? item.props : {};
            const appId = typeof props.appId === "string" ? props.appId : typeof props.app_id === "string" ? props.app_id : "";
            if (!MICRO_APP_IDS.includes(appId as (typeof MICRO_APP_IDS)[number])) {
                issues.push(issue(`${path}.props.appId`, "micro-app requires props.appId from the curated registry"));
            }
            if (item.data != null && isRecord(item.data) && item.data.tool !== "workspace_get_micro_app") {
                issues.push(issue(`${path}.data.tool`, "micro-app data.tool must be workspace_get_micro_app"));
            }
        }
        if (item.props != null) {
            if (!isRecord(item.props)) {
                issues.push(issue(`${path}.props`, "props must be an object"));
            } else {
                for (const key of Object.keys(item.props)) {
                    if (FORBIDDEN_PROP_KEYS.has(key) || FORBIDDEN_PROP_KEYS.has(key.toLowerCase())) {
                        issues.push(issue(`${path}.props.${key}`, `prop ${key} is not allowed on WorkspaceSpec`));
                    }
                }
            }
        }
        if (item.actions != null) {
            if (!Array.isArray(item.actions)) {
                issues.push(issue(`${path}.actions`, "actions must be an array"));
            } else {
                const unknown = item.actions.filter(
                    (action) => typeof action !== "string" || !ALLOWED_ACTIONS.includes(action as (typeof ALLOWED_ACTIONS)[number])
                );
                if (unknown.length) {
                    issues.push(issue(`${path}.actions`, `unsupported actions: ${unknown.join(", ")}`));
                }
            }
        }
    });
    return issues;
}

export function parseWorkspaceSpec(payload: unknown): WorkspaceSpec | null {
    if (validateWorkspaceSpec(payload).length) {
        return null;
    }
    const spec = payload as WorkspaceSpec;
    const symbols = Array.from(
        new Set((spec.universe?.symbols ?? []).map((item) => item.trim().toUpperCase()).filter(Boolean))
    ).slice(0, 40);
    return {
        ...spec,
        components: packComponentPositions(spec.components ?? []),
        universe: { symbols }
    };
}

export function emptyWorkspaceSpec(title = "Untitled desk"): WorkspaceSpec {
    return {
        components: [],
        layout: { columns: 12, mode: "grid" },
        title,
        universe: { symbols: [] },
        version: "1"
    };
}

export function cloneWorkspaceSpec(spec: WorkspaceSpec): WorkspaceSpec {
    return JSON.parse(JSON.stringify(spec)) as WorkspaceSpec;
}

export function nextComponentId(existingIds: string[], prefix: string): string {
    const slug = prefix
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, 40) || "widget";
    const base = /^\d/.test(slug) ? `c-${slug}` : slug;
    let candidate = base;
    let index = 2;
    const taken = new Set(existingIds);
    while (taken.has(candidate)) {
        candidate = `${base}-${index}`;
        index += 1;
    }
    return candidate;
}

export function nextGridPosition(
    spec: WorkspaceSpec,
    w = 6,
    h = 3
): { h: number; w: number; x: number; y: number } {
    const width = Math.max(1, Math.min(w, GRID_COLUMNS));
    const height = Math.max(1, Math.min(h, 24));
    const bottom = spec.components.reduce((maxY, item) => Math.max(maxY, item.position.y + item.position.h), 0);
    return { h: height, w: width, x: 0, y: bottom };
}

export function workspaceSpecsEqual(left: WorkspaceSpec, right: WorkspaceSpec): boolean {
    return JSON.stringify(left) === JSON.stringify(right);
}

export function specFromToolOutput(output: unknown): WorkspaceSpec | null {
    const unwrapped = unwrapToolOutput(output);
    if (!isRecord(unwrapped) || unwrapped.ok === false || unwrapped.valid === false || unwrapped.applied === false) {
        return null;
    }
    if (isRecord(unwrapped.spec)) {
        return parseWorkspaceSpec(unwrapped.spec);
    }
    return parseWorkspaceSpec(unwrapped);
}

export function latestSurfaceSpecFromMessages(messages: Array<{ parts?: unknown[]; role?: string }>): {
    key: string;
    spec: WorkspaceSpec;
} | null {
    for (let messageIndex = messages.length - 1; messageIndex >= 0; messageIndex -= 1) {
        const message = messages[messageIndex];
        if (message.role !== "assistant" || !Array.isArray(message.parts)) continue;
        for (let partIndex = message.parts.length - 1; partIndex >= 0; partIndex -= 1) {
            const part = message.parts[partIndex];
            if (!isRecord(part)) continue;
            const type = typeof part.type === "string" ? part.type : "";
            if (!type.includes("compose_surface") && !type.includes("patch_surface")) continue;
            const spec = specFromToolOutput(part.output);
            if (!spec) continue;
            const key = typeof part.toolCallId === "string" ? part.toolCallId : `${messageIndex}:${partIndex}`;
            return { key, spec };
        }
    }
    return null;
}
