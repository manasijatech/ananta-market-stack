import {
    ADAPTIVE_COMPONENT_TYPES,
    ALLOWED_ACTIONS,
    ALLOWED_DATA_TOOLS,
    GRID_COLUMNS,
    type WorkspaceSpec,
    type WorkspaceSpecIssue
} from "@/service/types/adaptive-workspace";

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

const ID_PATTERN = /^[a-z][a-z0-9-]*$/;
const SECRET_PARAM_KEYS = new Set(["api_key", "password", "pin", "totp", "secret", "token", "access_token"]);

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

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
    return payload as WorkspaceSpec;
}
