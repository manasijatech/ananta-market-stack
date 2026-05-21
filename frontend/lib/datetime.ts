export const INDIA_TIME_ZONE = "Asia/Kolkata";

const explicitTimeZonePattern = /(?:z|[+-]\d{2}:?\d{2})$/i;
const dateTimePattern = /^\d{4}-\d{2}-\d{2}[T\s]\d{2}:\d{2}/;

export function parseApiDate(value: string): Date {
    const trimmed = value.trim();
    if (dateTimePattern.test(trimmed) && !explicitTimeZonePattern.test(trimmed)) {
        return new Date(`${trimmed.replace(" ", "T")}Z`);
    }
    return new Date(trimmed);
}

export function formatIstDateTime(value?: string | null, fallback = "Not available"): string {
    if (!value) {
        return fallback;
    }
    const date = parseApiDate(value);
    if (Number.isNaN(date.getTime())) {
        return value;
    }
    return new Intl.DateTimeFormat("en-IN", {
        dateStyle: "medium",
        timeStyle: "short",
        timeZone: INDIA_TIME_ZONE
    }).format(date);
}
