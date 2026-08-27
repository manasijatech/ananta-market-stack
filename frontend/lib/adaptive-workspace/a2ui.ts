import {
    A2UI_CATALOG_ID,
    A2UI_ROOT_ID,
    A2UI_VERSION,
    ADAPTIVE_COMPONENT_TYPES,
    type WorkspaceSpec,
    type WorkspaceSpecIssue
} from "@/service/types/adaptive-workspace";
import { parseWorkspaceSpec, validateWorkspaceSpec } from "@/lib/adaptive-workspace/spec";
import { isRecord } from "@/lib/adaptive-workspace/tool-envelope";

export type A2UIMessage = Record<string, unknown>;

const GRID_TYPES = new Set(["Grid", "Column", "Row"]);

function componentTypeFromEntry(entry: Record<string, unknown>): { fields: Record<string, unknown>; type: string | null } {
    const raw = entry.component;
    if (typeof raw === "string") {
        const fields = { ...entry };
        delete fields.id;
        delete fields.component;
        delete fields.weight;
        return { fields, type: raw };
    }
    if (isRecord(raw) && Object.keys(raw).length === 1) {
        const [type, fields] = Object.entries(raw)[0];
        return { fields: isRecord(fields) ? fields : {}, type };
    }
    return { fields: {}, type: null };
}

export function workspaceSpecToA2UI(spec: WorkspaceSpec, surfaceId = "desk"): A2UIMessage[] {
    const children = spec.components.map((item) => item.id);
    const components: Record<string, unknown>[] = [
        { id: A2UI_ROOT_ID, component: "Grid", columns: 12, children }
    ];
    for (const item of spec.components) {
        components.push({
            id: item.id,
            component: item.type,
            position: item.position,
            data: item.data ?? null,
            props: item.props ?? {},
            actions: item.actions ?? []
        });
    }
    return [
        { version: A2UI_VERSION, createSurface: { surfaceId, catalogId: A2UI_CATALOG_ID } },
        { version: A2UI_VERSION, updateComponents: { surfaceId, components } },
        {
            version: A2UI_VERSION,
            updateDataModel: {
                surfaceId,
                path: "/",
                value: { title: spec.title, version: spec.version, layout: spec.layout }
            }
        }
    ];
}

export function a2uiToWorkspaceSpec(messages: unknown): { issues: WorkspaceSpecIssue[]; spec: WorkspaceSpec | null } {
    const list = isRecord(messages) && Array.isArray(messages.messages) ? messages.messages : messages;
    if (!Array.isArray(list) || !list.length) {
        return { issues: [{ path: "", message: "A2UI messages must be a non-empty list" }], spec: null };
    }
    let title = "Untitled desk";
    let layout: WorkspaceSpec["layout"] = { columns: 12, mode: "grid" };
    const collected: unknown[] = [];
    for (const [index, message] of list.entries()) {
        const path = `messages.${index}`;
        if (!isRecord(message)) {
            return { issues: [{ path, message: "A2UI message must be an object" }], spec: null };
        }
        const version = message.version;
        if (version != null && version !== A2UI_VERSION && version !== "0.9") {
            return { issues: [{ path: `${path}.version`, message: `unsupported A2UI version ${String(version)}` }], spec: null };
        }
        if ("createSurface" in message) {
            if (!isRecord(message.createSurface)) {
                return { issues: [{ path: `${path}.createSurface`, message: "createSurface must be an object" }], spec: null };
            }
            const catalogId = message.createSurface.catalogId;
            if (catalogId != null && catalogId !== A2UI_CATALOG_ID) {
                return { issues: [{ path: `${path}.createSurface.catalogId`, message: `catalog must be ${A2UI_CATALOG_ID}` }], spec: null };
            }
            continue;
        }
        if ("updateDataModel" in message) {
            if (isRecord(message.updateDataModel) && isRecord(message.updateDataModel.value)) {
                const value = message.updateDataModel.value;
                if (typeof value.title === "string" && value.title.trim()) title = value.title;
                if (isRecord(value.layout) && value.layout.mode === "grid" && value.layout.columns === 12) {
                    layout = { columns: 12, mode: "grid" };
                }
            }
            continue;
        }
        if (!("updateComponents" in message)) continue;
        if (!isRecord(message.updateComponents) || !Array.isArray(message.updateComponents.components)) {
            return { issues: [{ path: `${path}.updateComponents`, message: "components must be a list" }], spec: null };
        }
        for (const [componentIndex, entry] of message.updateComponents.components.entries()) {
            const componentPath = `${path}.updateComponents.components.${componentIndex}`;
            if (!isRecord(entry)) {
                return { issues: [{ path: componentPath, message: "component must be an object" }], spec: null };
            }
            const { fields, type } = componentTypeFromEntry(entry);
            if (!type) {
                return { issues: [{ path: `${componentPath}.component`, message: "component discriminator is required" }], spec: null };
            }
            if (GRID_TYPES.has(type) || entry.id === A2UI_ROOT_ID) continue;
            if (!ADAPTIVE_COMPONENT_TYPES.includes(type as (typeof ADAPTIVE_COMPONENT_TYPES)[number])) {
                return { issues: [{ path: `${componentPath}.component`, message: `component type ${type} is not in the catalog` }], spec: null };
            }
            if (typeof entry.id !== "string") {
                return { issues: [{ path: `${componentPath}.id`, message: "component id is required" }], spec: null };
            }
            const item: Record<string, unknown> = {
                id: entry.id,
                type,
                position: isRecord(fields.position) ? fields.position : entry.position
            };
            if (fields.data !== undefined || entry.data !== undefined) item.data = fields.data ?? entry.data;
            if (fields.props !== undefined || entry.props !== undefined) item.props = fields.props ?? entry.props;
            if (fields.actions !== undefined || entry.actions !== undefined) item.actions = fields.actions ?? entry.actions;
            collected.push(item);
        }
    }
    const payload = { components: collected, layout, title, version: "1" as const };
    const issues = validateWorkspaceSpec(payload);
    if (issues.length) return { issues, spec: null };
    return { issues: [], spec: parseWorkspaceSpec(payload) };
}

export function roundTripA2UI(spec: WorkspaceSpec, surfaceId = "desk") {
    const messages = workspaceSpecToA2UI(spec, surfaceId);
    return { ...a2uiToWorkspaceSpec(messages), messages };
}
