import { MICRO_APP_IDS, type MicroAppId } from "@/service/types/adaptive-workspace";
import { isRecord } from "@/lib/adaptive-workspace/tool-envelope";

export const MICRO_APP_REGISTRY: Record<
    MicroAppId,
    { actions: string[]; description: string; id: MicroAppId; label: string }
> = {
    "payoff-diagram": {
        actions: ["select", "refresh"],
        description: "Sandboxed P/L toy for a call, put, or straddle. Numbers only; no orders.",
        id: "payoff-diagram",
        label: "Options payoff"
    }
};

function finiteNumber(value: unknown, fallback: number, lo: number, hi: number) {
    if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
    return Math.min(hi, Math.max(lo, value));
}

export function isMicroAppId(value: unknown): value is MicroAppId {
    return typeof value === "string" && (MICRO_APP_IDS as readonly string[]).includes(value);
}

export function bindMicroAppPayload(appId: MicroAppId, source: Record<string, unknown> = {}) {
    if (appId === "payoff-diagram") {
        const kind = source.kind === "call" || source.kind === "put" || source.kind === "straddle" ? source.kind : "straddle";
        return {
            appId,
            kind,
            premium: finiteNumber(source.premium, 180, 0, 1_000_000),
            spot: finiteNumber(source.spot, 25000, 0.01, 10_000_000),
            strike: finiteNumber(source.strike, 25000, 0.01, 10_000_000),
            width_pct: finiteNumber(source.width_pct, 8, 1, 50)
        };
    }
    return { appId, kind: "straddle", premium: 180, spot: 25000, strike: 25000, width_pct: 8 };
}

function payoffSrcDoc(dataJson: string) {
    return `<!DOCTYPE html><html><head><meta charset="utf-8"/><meta name="color-scheme" content="dark light"/>
<style>
html,body{margin:0;padding:10px;font:12px/1.45 ui-sans-serif,system-ui,sans-serif;background:transparent;color:#e7e5e4}
svg{width:100%;height:168px;display:block}
.meta{color:#a8a29e;font-size:11px}
button{margin-top:8px;border:1px solid #44403c;background:#1c1917;color:#e7e5e4;border-radius:6px;padding:4px 8px;font:11px/1.2 inherit;cursor:pointer}
</style></head><body>
<div class="meta" id="meta"></div>
<svg id="chart" viewBox="0 0 320 168" role="img" aria-label="Payoff diagram"></svg>
<button type="button" id="select">Use these numbers</button>
<script>
const DATA = ${dataJson};
function payoff(kind, strike, premium, s){
  if(kind==="call") return Math.max(s-strike,0)-premium;
  if(kind==="put") return Math.max(strike-s,0)-premium;
  return Math.max(s-strike,0)+Math.max(strike-s,0)-(premium*2);
}
function draw(){
  const spot=Number(DATA.spot)||25000;
  const strike=Number(DATA.strike)||spot;
  const premium=Number(DATA.premium)||100;
  const kind=String(DATA.kind||"straddle");
  const width=Number(DATA.width_pct)||8;
  const lo=spot*(1-width/100), hi=spot*(1+width/100);
  const pts=[];
  for(let i=0;i<=40;i++){
    const s=lo+(hi-lo)*i/40;
    pts.push([s, payoff(kind,strike,premium,s)]);
  }
  const ys=pts.map(p=>p[1]);
  const minY=Math.min(0,...ys), maxY=Math.max(0,...ys);
  const span=Math.max(1, maxY-minY);
  const d=pts.map((p,i)=>{
    const x=10+(p[0]-lo)/(hi-lo)*300;
    const y=150-(p[1]-minY)/span*130;
    return (i?"L":"M")+x.toFixed(1)+" "+y.toFixed(1);
  }).join(" ");
  const zero=150-(0-minY)/span*130;
  document.getElementById("chart").innerHTML =
    '<path d="M10 '+zero.toFixed(1)+' H310" stroke="#57534e" fill="none"/>' +
    '<path d="'+d+'" stroke="#34d399" fill="none" stroke-width="2"/>';
  document.getElementById("meta").textContent =
    kind.toUpperCase()+"  spot "+spot+"  strike "+strike+"  premium "+premium;
}
function post(action, payload){
  parent.postMessage({source:"ananta-micro-app", appId: DATA.appId, action, payload}, "*");
}
document.getElementById("select").addEventListener("click", function(){
  post("select", {spot:DATA.spot, strike:DATA.strike, premium:DATA.premium, kind:DATA.kind});
});
window.addEventListener("message", function(ev){
  if(!ev.data || ev.data.source!=="ananta-host" || ev.data.type!=="bind") return;
  Object.assign(DATA, ev.data.payload||{});
  draw();
});
draw();
</script></body></html>`;
}

export function microAppSrcDoc(appId: MicroAppId, payload: Record<string, unknown>) {
    const dataJson = JSON.stringify(payload).replace(/</g, "\\u003c");
    return payoffSrcDoc(dataJson);
}

export function microAppIdFromComponent(props: Record<string, unknown> | undefined, params: Record<string, unknown> | undefined) {
    const candidate = props?.appId ?? props?.app_id ?? params?.app_id ?? params?.appId;
    return isMicroAppId(candidate) ? candidate : null;
}

export function isAllowedMicroAppAction(action: unknown) {
    return action === "select" || action === "refresh";
}

export function readMicroAppMessage(event: MessageEvent, sourceWindow: Window | null) {
    if (event.source !== sourceWindow || !isRecord(event.data)) return null;
    if (event.data.source !== "ananta-micro-app") return null;
    if (!isMicroAppId(event.data.appId) || !isAllowedMicroAppAction(event.data.action)) return null;
    return {
        action: event.data.action as "select" | "refresh",
        appId: event.data.appId,
        payload: isRecord(event.data.payload) ? event.data.payload : {}
    };
}
