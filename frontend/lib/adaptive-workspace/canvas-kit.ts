/** Host-injected Adaptive Workspace canvas kit. Keep in sync with backend adaptive_canvas_kit.py. */

export const CANVAS_KIT_CSS = `
:root {
  --aw-bg: #1c1c1c;
  --aw-fg: #f4f4f5;
  --aw-muted: #a1a1aa;
  --aw-surface: #2a2a2a;
  --aw-line: rgba(255,255,255,0.10);
  --aw-gold: #ffcd2e;
  --aw-gold-ink: #131722;
  --aw-up: #34d399;
  --aw-down: #f87171;
  --aw-pad: 12px;
}
html, body {
  margin: 0;
  padding: 0;
  background: var(--aw-bg);
  color: var(--aw-fg);
  font: 12.5px/1.45 ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
  -webkit-font-smoothing: antialiased;
}
.aw {
  padding: var(--aw-pad);
  min-height: 100%;
  box-sizing: border-box;
}
.aw-kicker {
  margin: 0 0 4px;
  font-size: 10px;
  font-weight: 650;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--aw-gold);
}
.aw-h {
  margin: 0;
  font-size: 15px;
  font-weight: 650;
  letter-spacing: -0.02em;
  color: var(--aw-fg);
}
.aw-sub, .aw-lead {
  margin: 6px 0 0;
  color: var(--aw-muted);
  font-size: 12px;
}
.aw-meta, .aw-src {
  margin: 8px 0 0;
  color: var(--aw-muted);
  font-size: 11px;
}
.aw-stack { display: flex; flex-direction: column; gap: 12px; }
.aw-row { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
.aw-grid-2, .aw-grid-3 {
  display: grid;
  gap: 10px;
}
.aw-grid-2 { grid-template-columns: repeat(2, minmax(0, 1fr)); }
.aw-grid-3 { grid-template-columns: repeat(3, minmax(0, 1fr)); }
@media (max-width: 520px) {
  .aw-grid-2, .aw-grid-3 { grid-template-columns: 1fr; }
}
.aw-card {
  background: var(--aw-surface);
  border: 1px solid var(--aw-line);
  border-radius: 8px;
  padding: 10px 12px;
}
.aw-rule {
  height: 1px;
  background: var(--aw-line);
  border: 0;
  margin: 2px 0;
}
.aw-stats {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(92px, 1fr));
  gap: 8px;
}
.aw-stat { min-width: 0; }
.aw-stat__label {
  display: block;
  font-size: 10px;
  font-weight: 650;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--aw-muted);
}
.aw-stat__value {
  display: block;
  margin-top: 2px;
  font-size: 16px;
  font-weight: 650;
  letter-spacing: -0.03em;
  font-variant-numeric: tabular-nums;
}
.aw-stat__delta {
  display: block;
  margin-top: 2px;
  font-size: 11px;
  font-variant-numeric: tabular-nums;
}
.aw-up { color: var(--aw-up); }
.aw-down { color: var(--aw-down); }
.aw-flat { color: var(--aw-muted); }
.aw-table-wrap { overflow: auto; }
.aw-table {
  width: 100%;
  border-collapse: collapse;
  font-variant-numeric: tabular-nums;
}
.aw-table th {
  text-align: left;
  font-size: 10px;
  font-weight: 650;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--aw-muted);
  border-bottom: 1px solid var(--aw-line);
  padding: 6px 8px 6px 0;
}
.aw-table td {
  padding: 7px 8px 7px 0;
  border-bottom: 1px solid var(--aw-line);
  vertical-align: top;
}
.aw-table tr:last-child td { border-bottom: 0; }
.aw-tl { display: flex; flex-direction: column; gap: 10px; }
.aw-tl__item {
  display: grid;
  grid-template-columns: 76px minmax(0, 1fr);
  gap: 10px;
  align-items: start;
}
.aw-tl__when {
  font-size: 11px;
  font-weight: 650;
  color: var(--aw-gold);
  padding-top: 1px;
}
.aw-tl__body { min-width: 0; color: var(--aw-fg); }
.aw-pill {
  display: inline-flex;
  align-items: center;
  height: 20px;
  padding: 0 8px;
  border-radius: 999px;
  border: 1px solid var(--aw-line);
  background: transparent;
  color: var(--aw-muted);
  font-size: 10px;
  font-weight: 650;
  letter-spacing: 0.04em;
  text-transform: uppercase;
}
.aw-pill--accent {
  background: var(--aw-gold);
  border-color: var(--aw-gold);
  color: var(--aw-gold-ink);
}
.aw-pill--muted { color: var(--aw-muted); }
.aw-list { margin: 0; padding-left: 16px; }
.aw-list li { margin: 0 0 6px; }
.aw-split {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
}
@media (max-width: 520px) { .aw-split { grid-template-columns: 1fr; } }
.aw-bar__track {
  height: 6px;
  border-radius: 99px;
  background: var(--aw-line);
  overflow: hidden;
}
.aw-bar__fill {
  height: 100%;
  background: var(--aw-gold);
  border-radius: 99px;
}
`.trim();

const BODY_INNER_RE = /<body\b[^>]*>([\s\S]*)<\/body>/i;

export function ensureCanvasKitDocument(document: string): string {
    const raw = document.trim();
    if (!raw) return raw;
    if (raw.includes("--aw-gold") && /<style[\s>]/i.test(raw)) {
        return raw;
    }
    const bodyMatch = BODY_INNER_RE.exec(raw);
    let inner = (bodyMatch ? bodyMatch[1] : raw).trim();
    inner = inner.replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, "").trim();
    if (!/\bclass=['"][^'"]*\baw\b/.test(inner)) {
        inner = `<div class="aw">${inner}</div>`;
    }
    const css = CANVAS_KIT_CSS.replace(/<\//g, "<\\/");
    return `<!DOCTYPE html><html><head><meta charset="utf-8"/><meta name="color-scheme" content="dark"/><style>${css}</style></head><body>${inner}</body></html>`;
}
