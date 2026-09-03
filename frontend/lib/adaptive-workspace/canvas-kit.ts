/** Host-injected Adaptive Workspace canvas kit. Keep in sync with backend adaptive_canvas_kit.py. */

export const CANVAS_KIT_VERSION = "4";

export const CANVAS_THEME_SCRIPT =
    "(function(){function apply(t){var m=t==='light'?'light':'dark';" +
    "document.documentElement.classList.remove('light','dark');" +
    "document.documentElement.classList.add(m);" +
    "document.documentElement.setAttribute('data-theme',m);" +
    "document.documentElement.style.colorScheme=m;}" +
    "apply(document.documentElement.getAttribute('data-theme')||'dark');" +
    "window.addEventListener('message',function(e){" +
    "if(!e.data||e.data.type!=='aw-theme')return;apply(e.data.theme);});})();";

export const CANVAS_INTERACT_SCRIPT =
    "(function(){function spark(el){var pts=[];try{pts=JSON.parse(el.getAttribute('data-aw-spark')||'[]')}" +
    "catch(e){return}if(!pts.length)return;var w=Math.max(240,el.clientWidth||320),h=Math.max(120,el.clientHeight||140);" +
    "var xs=pts.map(function(p){return +p[0]}),ys=pts.map(function(p){return +p[1]});" +
    "var minX=Math.min.apply(null,xs),maxX=Math.max.apply(null,xs),minY=Math.min.apply(null,ys),maxY=Math.max.apply(null,ys);" +
    "var dx=maxX-minX||1,dy=maxY-minY||1;" +
    "function xy(p){return [(p[0]-minX)/dx*(w-20)+10,h-14-(p[1]-minY)/dy*(h-28)];}" +
    "var d=pts.map(function(p,i){var c=xy(p);return (i?'L':'M')+c[0].toFixed(1)+','+c[1].toFixed(1)}).join(' ');" +
    "var ns='http://www.w3.org/2000/svg';var svg=document.createElementNS(ns,'svg');" +
    "svg.setAttribute('viewBox','0 0 '+w+' '+h);svg.setAttribute('width','100%');svg.setAttribute('height',String(h));" +
    "var path=document.createElementNS(ns,'path');path.setAttribute('d',d);path.setAttribute('fill','none');" +
    "path.setAttribute('stroke','var(--aw-gold)');path.setAttribute('stroke-width','2');svg.appendChild(path);" +
    "var marks=[];try{marks=JSON.parse(el.getAttribute('data-aw-marks')||'[]')}catch(e){}" +
    "marks.forEach(function(m){var t=+m.t||+m[0],v=+m.v||+m[1];var c=xy([t,v]);" +
    "var cir=document.createElementNS(ns,'circle');cir.setAttribute('cx',c[0]);cir.setAttribute('cy',c[1]);" +
    "cir.setAttribute('r','4');cir.setAttribute('fill','var(--aw-gold)');svg.appendChild(cir);" +
    "var tx=document.createElementNS(ns,'text');tx.setAttribute('x',c[0]+6);tx.setAttribute('y',c[1]-6);" +
    "tx.setAttribute('fill','var(--aw-fg)');tx.setAttribute('font-size','10');tx.textContent=m.label||m[2]||'';" +
    "svg.appendChild(tx);});el.innerHTML='';el.appendChild(svg);}" +
    "function tabs(root){var btns=[].slice.call(root.querySelectorAll('[data-aw-tab]'));" +
    "var panels=[].slice.call(root.querySelectorAll('[data-aw-panel]'));" +
    "function show(id){btns.forEach(function(b){b.setAttribute('aria-selected',String(b.getAttribute('data-aw-tab')===id));});" +
    "panels.forEach(function(p){p.hidden=p.getAttribute('data-aw-panel')!==id;});}" +
    "btns.forEach(function(b){b.addEventListener('click',function(){show(b.getAttribute('data-aw-tab'));});});" +
    "if(btns[0])show(btns[0].getAttribute('data-aw-tab'));}" +
    "document.querySelectorAll('[data-aw-spark]').forEach(spark);" +
    "document.querySelectorAll('[data-aw-tabs]').forEach(tabs);})();";

/** Parent posts {type:'aw-ltp', ticks:[...]}. Iframe never opens its own WebSocket. */
export const CANVAS_LTP_SCRIPT =
    "(function(){function fmt(n){if(n==null||!isFinite(n))return'\\u2014';" +
    "try{return new Intl.NumberFormat('en-IN',{maximumFractionDigits:2}).format(n)}catch(e){return String(n)}}" +
    "function chg(n){if(n==null||!isFinite(n))return null;var s=n>0?'+':n<0?'\\u2212':'';" +
    "return s+Math.abs(n).toFixed(2)+'%'}function tone(n){if(n==null||!isFinite(n)||n===0)return'flat';" +
    "return n>0?'up':'down'}function paint(el,tick){var kind=(el.getAttribute('data-kind')||'both');" +
    "var sym=el.getAttribute('data-symbol')||'';var ltp=tick&&tick.ltp!=null?+tick.ltp:+el.getAttribute('data-ltp');" +
    "var pct=tick&&tick.chgPct!=null?+tick.chgPct:+el.getAttribute('data-chg-pct');" +
    "if(!isFinite(ltp))ltp=null;if(!isFinite(pct))pct=null;var live=!!(tick&&tick.live);" +
    "var t=tone(pct);el.setAttribute('data-move',t);el.setAttribute('data-live',live?'1':'0');" +
    "var parts=[];parts.push('<span class=\"ananta-ltp__sym\">'+sym+'</span>');" +
    "if(kind!=='chgPct')parts.push('<span class=\"ananta-ltp__ltp\">'+fmt(ltp)+'</span>');" +
    "var c=chg(pct);if(kind!=='ltp'&&c)parts.push('<span class=\"ananta-ltp__chg\">('+c+')</span>');" +
    "el.innerHTML=parts.join(' ');" +
    "var asOf=el.getAttribute('data-as-of');el.title=live?'Live':(asOf?('As of '+asOf):'');" +
    "el.setAttribute('aria-label',[sym,ltp!=null?fmt(ltp)+' rupees':'',c||'',live?'live':(asOf||'')].filter(Boolean).join(', '));}" +
    "function all(){return [].slice.call(document.querySelectorAll('ananta-ltp'));}" +
    "function boot(){all().forEach(function(el){paint(el,null);});}" +
    "window.addEventListener('message',function(e){if(!e.data||e.data.type!=='aw-ltp')return;" +
    "var ticks=e.data.ticks||[];var map={};ticks.forEach(function(t){" +
    "if(!t||!t.symbol)return;var ex=(t.exchange||'NSE').toUpperCase();var sy=String(t.symbol).toUpperCase();" +
    "map[ex+':'+sy]=t;map[sy]=t;});" +
    "all().forEach(function(el){var ex=(el.getAttribute('data-exchange')||'NSE').toUpperCase();" +
    "var sy=(el.getAttribute('data-symbol')||'').toUpperCase();paint(el,map[ex+':'+sy]||map[sy]||null);});});" +
    "if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot);else boot();})();";

export const CANVAS_KIT_CSS = `
:root, html.light, html[data-theme="light"] {
  color-scheme: light;
  --aw-bg: #ffffff;
  --aw-fg: #18181b;
  --aw-muted: #71717a;
  --aw-surface: #f4f4f5;
  --aw-line: rgba(24, 24, 27, 0.12);
  --aw-gold: #c9a00e;
  --aw-gold-ink: #18181b;
  --aw-up: #059669;
  --aw-down: #dc2626;
  --aw-pad: 12px;
}
html.dark, html[data-theme="dark"] {
  color-scheme: dark;
  --aw-bg: #1c1c1c;
  --aw-fg: #f4f4f5;
  --aw-muted: #a1a1aa;
  --aw-surface: #2a2a2a;
  --aw-line: rgba(255,255,255,0.10);
  --aw-gold: #ffcd2e;
  --aw-gold-ink: #131722;
  --aw-up: #34d399;
  --aw-down: #f87171;
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
details.aw-fold {
  border: 1px solid var(--aw-line);
  border-radius: 8px;
  padding: 8px 10px;
  background: var(--aw-surface);
}
details.aw-fold + details.aw-fold { margin-top: 8px; }
details.aw-fold > summary {
  cursor: pointer;
  font-weight: 650;
  color: var(--aw-fg);
}
.aw-tabs { display: flex; flex-wrap: wrap; gap: 6px; }
.aw-tab {
  appearance: none;
  border: 1px solid var(--aw-line);
  background: transparent;
  color: var(--aw-muted);
  border-radius: 999px;
  padding: 4px 10px;
  font: inherit;
  cursor: pointer;
}
.aw-tab[aria-selected="true"] {
  background: var(--aw-gold);
  border-color: var(--aw-gold);
  color: var(--aw-gold-ink);
}
.aw-panel { margin-top: 10px; }
.aw-chart { width: 100%; min-height: 140px; }
ananta-ltp {
  display: inline-flex;
  align-items: baseline;
  gap: 0.35em;
  white-space: nowrap;
  font-weight: 650;
  font-variant-numeric: tabular-nums;
  vertical-align: baseline;
}
ananta-ltp[data-move="up"] { color: var(--aw-up); }
ananta-ltp[data-move="down"] { color: var(--aw-down); }
ananta-ltp[data-move="flat"], ananta-ltp:not([data-move]) { color: var(--aw-muted); }
ananta-ltp[data-live="0"] { opacity: 0.92; }
ananta-ltp .ananta-ltp__sym { font-family: inherit; letter-spacing: -0.02em; }
ananta-ltp .ananta-ltp__ltp, ananta-ltp .ananta-ltp__chg { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 0.95em; }
`.trim();

import {
    extractLiveLtpIslands,
    liveLtpTokensToElements,
    sanitizeAnantaLtpElements
} from "@/lib/live-ltp-island";

const BODY_INNER_RE = /<body\b[^>]*>([\s\S]*)<\/body>/i;

export function wrapCanvasDocument(bodyHtml: string, theme: "light" | "dark" = "dark"): string {
    let inner = bodyHtml.trim();
    if (!/\bclass=['"][^'"]*\baw\b/.test(inner)) {
        inner = `<div class="aw">${inner}</div>`;
    }
    const mode = theme === "light" ? "light" : "dark";
    const css = CANVAS_KIT_CSS.replace(/<\//g, "<\\/");
    const themeScript = CANVAS_THEME_SCRIPT.replace(/<\//g, "<\\/");
    const interact = CANVAS_INTERACT_SCRIPT.replace(/<\//g, "<\\/");
    const ltp = CANVAS_LTP_SCRIPT.replace(/<\//g, "<\\/");
    return `<!DOCTYPE html><html class="${mode}" data-theme="${mode}"><head><meta charset="utf-8"/><meta name="color-scheme" content="light dark"/><style>${css}</style><script>${themeScript}</script></head><body>${inner}<script>${interact}</script><script>${ltp}</script></body></html>`;
}

export function ensureCanvasKitDocument(document: string, theme: "light" | "dark" = "dark"): string {
    const raw = document.trim();
    if (!raw) return raw;
    const bodyMatch = BODY_INNER_RE.exec(raw);
    let inner = (bodyMatch ? bodyMatch[1] : raw).trim();
    inner = inner.replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, "").trim();
    inner = inner.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "").trim();
    inner = sanitizeAnantaLtpElements(liveLtpTokensToElements(inner));
    return wrapCanvasDocument(inner, theme);
}

export function canvasDocumentLtpSymbols(document: string) {
    return extractLiveLtpIslands(document).map((row) => ({
        exchange: row.exchange,
        symbol: row.symbol
    }));
}
