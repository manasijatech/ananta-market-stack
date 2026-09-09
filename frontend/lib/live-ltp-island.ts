/** Closed grammar for Adaptive live LTP islands. Shareable with OSS. */

export const LIVE_LTP_MAX_ISLANDS = 24;
export const ANANTA_LTP_PROTOCOL = "ananta-ltp:";
/** Streamdown-safe path prefix (custom schemes are rewritten to [blocked]). */
export const ANANTA_LTP_PATH_PREFIX = "/__ananta-ltp__/";

export type LiveLtpKind = "ltp" | "chgPct" | "both";

export type LiveLtpIslandAttrs = {
    asOf?: string | null;
    chgPct?: number | null;
    exchange: string;
    kind: LiveLtpKind;
    ltp?: number | null;
    symbol: string;
};

export type LiveLtpDisplayed = {
    chgPct: number | null;
    ltp: number | null;
};

const TOKEN_RE =
    /\{\{ltp:([A-Za-z0-9]+):([A-Za-z0-9._-]+)((?:\|[A-Za-z][A-Za-z0-9_]*=[^|}]+)+)?\}\}/g;

const SAFE_ATTR_KEYS = new Set(["asOf", "chgPct", "kind", "ltp"]);

function parseNumber(raw: string | undefined): number | null {
    if (raw == null || raw === "") return null;
    const n = Number(raw);
    return Number.isFinite(n) ? n : null;
}

function parseKind(raw: string | undefined): LiveLtpKind {
    const v = String(raw || "")
        .trim()
        .toLowerCase();
    if (v === "chgpct" || v === "chg" || v === "pct") return "chgPct";
    if (v === "ltp" || v === "price") return "ltp";
    return "both";
}

export function islandKey(exchange: string, symbol: string): string {
    return `${String(exchange || "NSE").trim().toUpperCase()}:${String(symbol || "")
        .trim()
        .toUpperCase()}`;
}

export function parseLiveLtpToken(token: string): LiveLtpIslandAttrs | null {
    const match = TOKEN_RE.exec(token);
    TOKEN_RE.lastIndex = 0;
    if (!match || match[0] !== token.trim()) return null;
    return attrsFromMatch(match[1], match[2], match[3] || "");
}

function attrsFromMatch(exchangeRaw: string, symbolRaw: string, pipeAttrs: string): LiveLtpIslandAttrs | null {
    const exchange = String(exchangeRaw || "")
        .trim()
        .toUpperCase();
    const symbol = String(symbolRaw || "")
        .trim()
        .toUpperCase();
    if (!exchange || !symbol || !/^[A-Z0-9]+$/.test(exchange) || !/^[A-Z0-9._-]+$/.test(symbol)) {
        return null;
    }
    const bag: Record<string, string> = {};
    for (const part of pipeAttrs.split("|")) {
        if (!part) continue;
        const eq = part.indexOf("=");
        if (eq <= 0) continue;
        const key = part.slice(0, eq).trim();
        const value = part.slice(eq + 1).trim();
        if (!SAFE_ATTR_KEYS.has(key)) continue;
        if (/[<>"'`]/.test(value) || /\bon\w+/i.test(value)) continue;
        bag[key] = value;
    }
    return {
        asOf: bag.asOf || null,
        chgPct: parseNumber(bag.chgPct),
        exchange,
        kind: parseKind(bag.kind),
        ltp: parseNumber(bag.ltp),
        symbol
    };
}

export function parseLiveLtpAttrsFromMatch(
    exchange: string,
    symbol: string,
    pipeAttrs: string
): LiveLtpIslandAttrs | null {
    return attrsFromMatch(exchange, symbol, pipeAttrs);
}

/** Extract islands from markdown / HTML without mutating. Caps at max. */
export function extractLiveLtpIslands(text: string, max = LIVE_LTP_MAX_ISLANDS): LiveLtpIslandAttrs[] {
    const out: LiveLtpIslandAttrs[] = [];
    const seen = new Set<string>();
    TOKEN_RE.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = TOKEN_RE.exec(text)) && out.length < max) {
        const attrs = attrsFromMatch(match[1], match[2], match[3] || "");
        if (!attrs) continue;
        const key = islandKey(attrs.exchange, attrs.symbol);
        if (seen.has(key)) continue;
        seen.add(key);
        out.push(attrs);
    }
    TOKEN_RE.lastIndex = 0;

    const tagRe =
        /<ananta-ltp\b([^>]*)\/?>/gi;
    let tagMatch: RegExpExecArray | null;
    while ((tagMatch = tagRe.exec(text)) && out.length < max) {
        const attrs = parseAnantaLtpAttributeString(tagMatch[1] || "");
        if (!attrs) continue;
        const key = islandKey(attrs.exchange, attrs.symbol);
        if (seen.has(key)) continue;
        seen.add(key);
        out.push(attrs);
    }
    return out;
}

export function parseAnantaLtpAttributeString(raw: string): LiveLtpIslandAttrs | null {
    if (/\bon\w+\s*=/i.test(raw) || /\b(?:href|src)\s*=/i.test(raw)) {
        // Still allow the element if we can recover safe data-* only — strip danger by ignoring those attrs.
    }
    const get = (name: string): string | null => {
        const re = new RegExp(`\\bdata-${name}\\s*=\\s*["']([^"']*)["']`, "i");
        const m = re.exec(raw);
        return m ? m[1] : null;
    };
    const symbol = (get("symbol") || "").trim().toUpperCase();
    const exchange = (get("exchange") || "NSE").trim().toUpperCase();
    if (!symbol || !/^[A-Z0-9._-]+$/.test(symbol) || !/^[A-Z0-9]+$/.test(exchange)) return null;
    return {
        asOf: get("as-of"),
        chgPct: parseNumber(get("chg-pct") || undefined),
        exchange,
        kind: parseKind(get("kind") || undefined),
        ltp: parseNumber(get("ltp") || undefined),
        symbol
    };
}

export function formatLiveLtpFlatten(
    symbol: string,
    displayed: LiveLtpDisplayed,
    kind: LiveLtpKind = "both"
): string {
    const sym = symbol.trim().toUpperCase() || "—";
    const ltp =
        displayed.ltp != null && Number.isFinite(displayed.ltp)
            ? new Intl.NumberFormat("en-IN", { maximumFractionDigits: 2 }).format(displayed.ltp)
            : null;
    const chg =
        displayed.chgPct != null && Number.isFinite(displayed.chgPct)
            ? `${displayed.chgPct >= 0 ? "+" : ""}${displayed.chgPct.toFixed(2)}%`
            : null;
    if (kind === "ltp") {
        return ltp != null ? `${sym} ${ltp}` : sym;
    }
    if (kind === "chgPct") {
        return chg != null ? `${sym} (${chg})` : sym;
    }
    if (ltp != null && chg != null) return `${sym} ${ltp} (${chg})`;
    if (ltp != null) return `${sym} ${ltp}`;
    if (chg != null) return `${sym} (${chg})`;
    return `${sym} —`;
}

/**
 * Replace island tokens (and ananta-ltp markdown links) with clipboard-friendly text.
 * Prefer `displayed` map (live values) over snapshot attrs in the token.
 */
export function flattenLiveLtpIslands(
    text: string,
    displayed: Record<string, LiveLtpDisplayed> = {},
    max = LIVE_LTP_MAX_ISLANDS
): string {
    let count = 0;
    let out = text.replace(TOKEN_RE, (full, exchange: string, symbol: string, pipeAttrs: string) => {
        const attrs = attrsFromMatch(exchange, symbol, pipeAttrs || "");
        if (!attrs) return full;
        count += 1;
        if (count > max) {
            return formatLiveLtpFlatten(attrs.symbol, { ltp: attrs.ltp ?? null, chgPct: attrs.chgPct ?? null }, attrs.kind);
        }
        const key = islandKey(attrs.exchange, attrs.symbol);
        const live = displayed[key];
        return formatLiveLtpFlatten(
            attrs.symbol,
            {
                chgPct: live?.chgPct ?? attrs.chgPct ?? null,
                ltp: live?.ltp ?? attrs.ltp ?? null
            },
            attrs.kind
        );
    });

    out = out.replace(
        /\[([^\]]*)\]\(\/__ananta-ltp__\/([^/?#]+)\/([^)?#]+)(\?[^)]*)?\)/gi,
        (_full, _label: string, exchange: string, symbol: string, query = "") => {
            const params = new URLSearchParams(String(query || "").replace(/^\?/, ""));
            const attrs: LiveLtpIslandAttrs = {
                asOf: params.get("asOf"),
                chgPct: parseNumber(params.get("chgPct") || undefined),
                exchange: String(exchange || "NSE").toUpperCase(),
                kind: parseKind(params.get("kind") || undefined),
                ltp: parseNumber(params.get("ltp") || undefined),
                symbol: String(symbol || "").toUpperCase()
            };
            const key = islandKey(attrs.exchange, attrs.symbol);
            const live = displayed[key];
            return formatLiveLtpFlatten(
                attrs.symbol,
                {
                    chgPct: live?.chgPct ?? attrs.chgPct ?? null,
                    ltp: live?.ltp ?? attrs.ltp ?? null
                },
                attrs.kind
            );
        }
    );
    // Legacy ananta-ltp:// links (pre-sanitize path) still flatten if present in clipboard source.
    out = out.replace(
        /\[([^\]]*)\]\(ananta-ltp:\/\/([^/?#]+)\/([^)?#]+)(\?[^)]*)?\)/gi,
        (_full, _label: string, exchange: string, symbol: string, query = "") => {
            const params = new URLSearchParams(String(query || "").replace(/^\?/, ""));
            const attrs: LiveLtpIslandAttrs = {
                asOf: params.get("asOf"),
                chgPct: parseNumber(params.get("chgPct") || undefined),
                exchange: String(exchange || "NSE").toUpperCase(),
                kind: parseKind(params.get("kind") || undefined),
                ltp: parseNumber(params.get("ltp") || undefined),
                symbol: String(symbol || "").toUpperCase()
            };
            const key = islandKey(attrs.exchange, attrs.symbol);
            const live = displayed[key];
            return formatLiveLtpFlatten(
                attrs.symbol,
                {
                    chgPct: live?.chgPct ?? attrs.chgPct ?? null,
                    ltp: live?.ltp ?? attrs.ltp ?? null
                },
                attrs.kind
            );
        }
    );
    return out;
}

/** Preprocess agent tokens into Streamdown-safe markdown links (link-hijack path). */
export function liveLtpTokensToMarkdownLinks(text: string, max = LIVE_LTP_MAX_ISLANDS): string {
    let count = 0;
    return text.replace(TOKEN_RE, (full, exchange: string, symbol: string, pipeAttrs: string) => {
        const attrs = attrsFromMatch(exchange, symbol, pipeAttrs || "");
        if (!attrs) return full;
        count += 1;
        if (count > max) {
            return formatLiveLtpFlatten(attrs.symbol, { ltp: attrs.ltp ?? null, chgPct: attrs.chgPct ?? null }, attrs.kind);
        }
        const qs = new URLSearchParams();
        if (attrs.ltp != null) qs.set("ltp", String(attrs.ltp));
        if (attrs.chgPct != null) qs.set("chgPct", String(attrs.chgPct));
        if (attrs.asOf) qs.set("asOf", attrs.asOf);
        if (attrs.kind !== "both") qs.set("kind", attrs.kind);
        const q = qs.toString();
        return `[${attrs.symbol}](${ANANTA_LTP_PATH_PREFIX}${attrs.exchange}/${attrs.symbol}${q ? `?${q}` : ""})`;
    });
}

export function parseAnantaLtpHref(href: string | null | undefined): LiveLtpIslandAttrs | null {
    if (!href) return null;
    const trimmed = href.trim();
    if (trimmed.startsWith(ANANTA_LTP_PATH_PREFIX) || trimmed.startsWith("/__ananta-ltp__/")) {
        try {
            const url = new URL(trimmed, "https://ananta.local");
            const parts = url.pathname.replace(/^\/__ananta-ltp__\//, "").split("/");
            const exchange = (parts[0] || "NSE").toUpperCase();
            const symbol = decodeURIComponent(parts[1] || "").toUpperCase();
            if (!symbol) return null;
            return {
                asOf: url.searchParams.get("asOf"),
                chgPct: parseNumber(url.searchParams.get("chgPct") || undefined),
                exchange,
                kind: parseKind(url.searchParams.get("kind") || undefined),
                ltp: parseNumber(url.searchParams.get("ltp") || undefined),
                symbol
            };
        } catch {
            return null;
        }
    }
    if (!trimmed.toLowerCase().startsWith("ananta-ltp://")) return null;
    try {
        const url = new URL(trimmed);
        const exchange = (url.hostname || "NSE").toUpperCase();
        const symbol = decodeURIComponent(url.pathname.replace(/^\//, "")).toUpperCase();
        if (!symbol) return null;
        return {
            asOf: url.searchParams.get("asOf"),
            chgPct: parseNumber(url.searchParams.get("chgPct") || undefined),
            exchange,
            kind: parseKind(url.searchParams.get("kind") || undefined),
            ltp: parseNumber(url.searchParams.get("ltp") || undefined),
            symbol
        };
    } catch {
        return null;
    }
}

/** Convert tokens to safe <ananta-ltp> elements for canvas HTML. */
export function liveLtpTokensToElements(text: string, max = LIVE_LTP_MAX_ISLANDS): string {
    let count = 0;
    return text.replace(TOKEN_RE, (full, exchange: string, symbol: string, pipeAttrs: string) => {
        const attrs = attrsFromMatch(exchange, symbol, pipeAttrs || "");
        if (!attrs) return full;
        count += 1;
        if (count > max) {
            return formatLiveLtpFlatten(attrs.symbol, { ltp: attrs.ltp ?? null, chgPct: attrs.chgPct ?? null }, attrs.kind);
        }
        return serializeAnantaLtpElement(attrs);
    });
}

export function serializeAnantaLtpElement(attrs: LiveLtpIslandAttrs): string {
    const parts = [
        `data-symbol="${attrs.symbol}"`,
        `data-exchange="${attrs.exchange}"`,
        `data-kind="${attrs.kind}"`
    ];
    if (attrs.ltp != null) parts.push(`data-ltp="${attrs.ltp}"`);
    if (attrs.chgPct != null) parts.push(`data-chg-pct="${attrs.chgPct}"`);
    if (attrs.asOf) parts.push(`data-as-of="${attrs.asOf.replace(/"/g, "")}"`);
    return `<ananta-ltp ${parts.join(" ")}></ananta-ltp>`;
}

/** Rewrite any <ananta-ltp …> to allowlisted data-* only (strips onclick/src/href). */
export function sanitizeAnantaLtpElements(html: string, max = LIVE_LTP_MAX_ISLANDS): string {
    let count = 0;
    return html.replace(/<ananta-ltp\b([^>]*)(?:\/>|><\/ananta-ltp>|>)/gi, (full, attrRaw: string) => {
        const attrs = parseAnantaLtpAttributeString(attrRaw || "");
        if (!attrs) return "";
        count += 1;
        if (count > max) {
            return formatLiveLtpFlatten(attrs.symbol, { ltp: attrs.ltp ?? null, chgPct: attrs.chgPct ?? null }, attrs.kind);
        }
        return serializeAnantaLtpElement(attrs);
    });
}
