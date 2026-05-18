"use client";

import Image from "next/image";
import Link from "next/link";
import { IconBrandGithub, IconCircleCheck } from "@tabler/icons-react";
import {
  Handle,
  MarkerType,
  Position,
  ReactFlow,
  type Edge,
  type Node,
  type NodeProps
} from "@xyflow/react";
import { useEffect, useMemo, useState } from "react";
import {
  Activity,
  ArrowRight,
  CheckCircle2,
  Check,
  Copy,
  Lock,
  Route,
  Server,
  Zap
} from "lucide-react";
import { BrandLogo } from "@/components/brand-logo";
import { useSession } from "@/components/session-provider";
import { ThemeToggle } from "@/components/theme-toggle";
import { getAlphaSymbolMetadata } from "@/service/actions/alpha/symbols";
import type { AlphaSymbolMetadata } from "@/service/types/alpha/symbols";

const brokers = [
  { name: "Zerodha", src: "/broker-logos/zerodha.jpg", latency: "42 ms", state: "Kite session" },
  { name: "Upstox", src: "/broker-logos/upstox.jpg", latency: "55 ms", state: "OAuth ready" },
  { name: "Angel One", src: "/broker-logos/angel.jpg", latency: "61 ms", state: "TOTP active" },
  { name: "Dhan", src: "/broker-logos/dhan.jpg", latency: "48 ms", state: "Consent live" },
  { name: "Groww", src: "/broker-logos/groww.jpg", latency: "74 ms", state: "Token ready" },
  { name: "INDmoney", src: "/broker-logos/indmoney.jpg", latency: "89 ms", state: "Manual token" },
  { name: "Kotak Neo", src: "/broker-logos/kotak.jpg", latency: "67 ms", state: "Session bundle" }
];

const deployCommand = `git clone https://github.com/manasijatech/Market-Stack.git
cd Market-Stack
docker compose up --build`;

const orderRows = [
  { price: "22,648.10", bid: 74, ask: 22, volume: "1.8Cr", tone: "bid" },
  { price: "22,647.85", bid: 48, ask: 38, volume: "72L", tone: "bid" },
  { price: "22,647.40", bid: 61, ask: 16, volume: "91L", tone: "bid" },
  { price: "22,646.95", bid: 29, ask: 70, volume: "2.1Cr", tone: "ask" },
  { price: "22,646.50", bid: 52, ask: 44, volume: "64L", tone: "neutral" },
  { price: "22,646.05", bid: 18, ask: 81, volume: "3.4Cr", tone: "ask" },
  { price: "22,645.60", bid: 66, ask: 28, volume: "1.1Cr", tone: "bid" },
  { price: "22,645.15", bid: 39, ask: 62, volume: "83L", tone: "ask" },
  { price: "22,644.70", bid: 57, ask: 31, volume: "57L", tone: "neutral" }
];

const trades = [
  { symbol: "NIFTY", side: "buy", top: "16%", left: "63%", size: 46, delay: "0s" },
  { symbol: "RELIANCE", side: "sell", top: "34%", left: "72%", size: 34, delay: "1.4s" },
  { symbol: "HDFCBANK", side: "buy", top: "52%", left: "58%", size: 38, delay: "2.6s" },
  { symbol: "TCS", side: "buy", top: "68%", left: "77%", size: 30, delay: "3.8s" },
  { symbol: "BANKNIFTY", side: "sell", top: "76%", left: "52%", size: 42, delay: "4.8s" }
];

const tickerItems = [
  { symbol: "RELIANCE", text: "RELIANCE +1.82%" },
  { symbol: "NIFTY", text: "NIFTY 22,647.40" },
  { symbol: "BANKNIFTY", text: "BANKNIFTY -0.34%" },
  { symbol: "INFY", text: "INFY +0.71%" },
  { symbol: "BEL", text: "52W HIGH: BEL" },
  { symbol: "KEC", text: "ORDER WIN: KEC" },
  { symbol: "CDSL", text: "CONCALL: CDSL" },
  { symbol: null, text: "ALERT DELIVERED: TELEGRAM" }
];

const heatmapTiles = [
  { symbol: "RELIANCE", label: "Order win watch", tone: "up", span: "md:col-span-2 md:row-span-2" },
  { symbol: "HDFCBANK", label: "Delivery spike", tone: "flat", span: "" },
  { symbol: "TCS", label: "Concall digest", tone: "up", span: "" },
  { symbol: "INFY", label: "News drift", tone: "down", span: "" },
  { symbol: "BEL", label: "52w high", tone: "hot", span: "md:col-span-2" },
  { symbol: "CDSL", label: "Guidance alert", tone: "up", span: "" },
  { symbol: "NIFTY", label: "Index pulse", tone: "flat", span: "" },
  { symbol: "SBIN", label: "Volume watch", tone: "down", span: "" },
  { symbol: "LT", label: "Announcement", tone: "hot", span: "" }
];

type WorkflowNodeData = {
  detail: string;
  hasSource?: boolean;
  hasTarget?: boolean;
  label: string;
  meta: string;
  tone?: "accent" | "positive" | "muted";
};

const workflowNodes: Node<WorkflowNodeData>[] = [
  {
    id: "feed",
    type: "workflow",
    data: { detail: "Broker tick", hasSource: true, label: "Feed", meta: "NIFTY 22,647", tone: "positive" },
    position: { x: 54, y: 20 }
  },
  {
    id: "stream",
    type: "workflow",
    data: { detail: "Live subscription", hasSource: true, hasTarget: true, label: "Stream", meta: "42ms websocket" },
    position: { x: 360, y: 20 }
  },
  {
    id: "rule",
    type: "workflow",
    data: { detail: "Guard matched", hasSource: true, hasTarget: true, label: "Rule", meta: "volume + price" },
    position: { x: 54, y: 210 }
  },
  {
    id: "context",
    type: "workflow",
    data: { detail: "Optional model note", hasSource: true, hasTarget: true, label: "Context", meta: "risk summary", tone: "muted" },
    position: { x: 360, y: 210 }
  },
  {
    id: "channel",
    type: "workflow",
    data: { detail: "Telegram ack", hasTarget: true, label: "Channel", meta: "delivered 189ms", tone: "positive" },
    position: { x: 666, y: 210 }
  }
];

const workflowEdges: Edge[] = [
  { id: "feed-stream", source: "feed", target: "stream" },
  { id: "stream-rule", source: "stream", target: "rule" },
  { id: "rule-context", source: "rule", target: "context" },
  { id: "context-channel", source: "context", target: "channel" }
].map((edge) => ({
  ...edge,
  type: "smoothstep",
  markerEnd: { type: MarkerType.ArrowClosed },
  className: "workflow-flow-edge"
}));

const workflowNodeTypes = {
  workflow: WorkflowFlowNode
};

const landingSymbols = Array.from(new Set([
  ...trades.map((trade) => trade.symbol),
  ...tickerItems.flatMap((item) => item.symbol ? [item.symbol] : []),
  ...heatmapTiles.map((tile) => tile.symbol)
]));

function symbolInitials(symbol: string) {
  return symbol.slice(0, 2).toUpperCase();
}

function WorkflowFlowNode({ data }: NodeProps<Node<WorkflowNodeData>>) {
  return (
    <div className={`workflow-flow-node workflow-flow-node--${data.tone ?? "accent"}`}>
      {data.hasTarget ? <Handle className="workflow-flow-handle workflow-flow-handle--target" position={Position.Left} type="target" /> : null}
      <div className="workflow-flow-node__label">{data.label}</div>
      <div className="workflow-flow-node__detail">{data.detail}</div>
      <div className="workflow-flow-node__meta">{data.meta}</div>
      {data.hasSource ? <Handle className="workflow-flow-handle workflow-flow-handle--source" position={Position.Right} type="source" /> : null}
    </div>
  );
}

function SymbolLogo({
  className = "",
  metadata,
  symbol
}: {
  className?: string;
  metadata?: AlphaSymbolMetadata;
  symbol: string;
}) {
  if (metadata?.logo) {
    return <img alt="" className={`symbol-logo ${className}`} src={metadata.logo} />;
  }

  return (
    <span className={`symbol-logo-fallback ${className}`} aria-hidden="true">
      {symbolInitials(symbol)}
    </span>
  );
}

function TickerTape({ symbolMetadata }: { symbolMetadata: Record<string, AlphaSymbolMetadata> }) {
  return (
    <div className="market-ticker text-[11px]">
      <div className="market-ticker__track">
        {[...tickerItems, ...tickerItems, ...tickerItems].map((item, index) => (
          <span className="market-ticker__item" key={`${item.text}-${index}`}>
            {item.symbol ? (
              <SymbolLogo
                className="market-ticker__logo"
                metadata={symbolMetadata[item.symbol]}
                symbol={item.symbol}
              />
            ) : null}
            {item.text}
          </span>
        ))}
      </div>
    </div>
  );
}

function LiquidityHeroScene({ symbolMetadata }: { symbolMetadata: Record<string, AlphaSymbolMetadata> }) {
  return (
    <div className="liquidity-scene" aria-hidden="true">
      <div className="liquidity-grid" />
      <div className="landing-scene-label absolute left-4 top-4 hidden font-mono text-[10px] uppercase min-[760px]:block">
        Market Stack live order-flow simulation
      </div>
      <div className="landing-scene-label absolute right-5 top-5 hidden grid gap-2 font-mono text-[10px] min-[980px]:grid">
        <span>REDIS STREAM: OK</span>
        <span>WORKERS: 03</span>
        <span>ALERT BUS: 24/s</span>
      </div>
      <div className="liquidity-book">
        {orderRows.map((row, index) => (
          <div className={`liquidity-row liquidity-row--${row.tone}`} key={row.price}>
            <span className="liquidity-price">{row.price}</span>
            <span className="liquidity-depth liquidity-depth--bid" style={{ width: `${row.bid}%`, animationDelay: `${index * 130}ms` }} />
            <span className="liquidity-depth liquidity-depth--ask" style={{ width: `${row.ask}%`, animationDelay: `${index * 160}ms` }} />
            <span className="liquidity-volume">{row.volume}</span>
          </div>
        ))}
      </div>
      <svg className="liquidity-price-line" viewBox="0 0 900 420" preserveAspectRatio="none">
        <path d="M 0 240 C 95 220 138 180 230 205 S 375 282 470 215 S 610 112 712 154 S 820 260 900 198" />
      </svg>
      {trades.map((trade) => (
        <div
          className={`trade-bubble trade-bubble--${trade.side}`}
          key={`${trade.symbol}-${trade.left}`}
          style={{
            animationDelay: trade.delay,
            height: trade.size,
            left: trade.left,
            top: trade.top,
            width: trade.size
          }}
        >
          <SymbolLogo
            className="trade-bubble__logo"
            metadata={symbolMetadata[trade.symbol]}
            symbol={trade.symbol}
          />
          <span>{trade.symbol}</span>
        </div>
      ))}
    </div>
  );
}

function BrokerSignalMap() {
  return (
    <section className="landing-section landing-section--tight">
      <div className="mx-auto grid max-w-7xl gap-10 min-[980px]:grid-cols-[0.9fr_1.1fr]">
        <div>
          <p className="landing-eyebrow">Broker routing</p>
          <h2 className="mt-4 max-w-xl text-3xl font-semibold leading-tight md:text-4xl">
            Many broker sessions. One private market operations layer.
          </h2>
          <p className="landing-copy mt-5 max-w-2xl text-sm leading-6 md:text-base">
            Market Stack turns fragmented broker APIs into a single self-hosted workspace for sessions, quotes,
            positions, instruments, and live data subscriptions.
          </p>
        </div>
        <div className="signal-map">
          <div className="broker-flow" aria-label="Connected broker sessions">
            {brokers.map((broker, index) => (
              <div className="broker-node" key={broker.name} style={{ animationDelay: `${index * 180}ms` }}>
                <div className="broker-logo-frame relative size-9 overflow-hidden">
                  <Image src={broker.src} alt="" fill className="object-cover" sizes="36px" />
                </div>
                <div className="min-w-0">
                  <div className="truncate text-sm font-semibold">{broker.name}</div>
                  <div className="landing-overline">{broker.state} · {broker.latency}</div>
                </div>
                <IconCircleCheck className="landing-status-check ml-auto size-5" stroke={1.9} aria-label="Connected" />
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

function WorkflowTimeline() {
  return (
    <section className="workflow-machine-section">
      <div className="workflow-machine-layout mx-auto max-w-7xl px-5">
        <div className="workflow-machine-heading">
          <p className="landing-eyebrow">Workflow execution</p>
          <h2 className="mt-4 max-w-3xl text-3xl font-semibold leading-tight md:text-4xl">
            One live signal path from broker tick to delivered alert.
          </h2>
          <p className="landing-copy mt-5 max-w-md text-sm leading-6">
            The product surface is not a notification widget. It is the execution machine behind the alert: feed,
            stream, rule, optional model context, and channel acknowledgement.
          </p>
        </div>
        <div className="workflow-flow-canvas" aria-label="Alert workflow from feed to channel acknowledgement">
          <ReactFlow
            nodes={workflowNodes}
            edges={workflowEdges}
            nodeTypes={workflowNodeTypes}
            fitView
            fitViewOptions={{ padding: 0.16 }}
            nodesDraggable={false}
            nodesConnectable={false}
            elementsSelectable={false}
            panOnDrag={false}
            panOnScroll={false}
            zoomOnDoubleClick={false}
            zoomOnPinch={false}
            zoomOnScroll={false}
            preventScrolling={false}
            proOptions={{ hideAttribution: true }}
          />
        </div>
      </div>
    </section>
  );
}

function MarketHeatmap({ symbolMetadata }: { symbolMetadata: Record<string, AlphaSymbolMetadata> }) {
  return (
    <section className="landing-section">
      <div className="mx-auto grid max-w-7xl gap-12 min-[1040px]:grid-cols-[0.85fr_1.15fr]">
        <div>
          <p className="landing-eyebrow">Watchlists + Alpha intelligence</p>
          <h2 className="mt-4 max-w-xl text-3xl font-semibold leading-tight md:text-4xl">
            A living map of the symbols, feeds, and events you care about.
          </h2>
          <p className="landing-copy mt-5 max-w-2xl text-sm leading-6 md:text-base">
            Watchlists connect to news, announcements, earnings, concalls, broker instruments, and alert workflows.
            The product surface is the market moving through your own filters.
          </p>
          <div className="landing-list mt-8 grid gap-3 font-mono text-xs">
            <div className="flex items-center gap-3"><CheckCircle2 className="size-4" /> Preset and manual watchlists</div>
            <div className="flex items-center gap-3"><CheckCircle2 className="size-4" /> Live Alpha websocket feeds</div>
            <div className="flex items-center gap-3"><CheckCircle2 className="size-4" /> Symbol metadata and instrument search</div>
          </div>
        </div>
        <div className="market-heatmap">
          {heatmapTiles.map((tile, index) => (
            <div className={`market-tile market-tile--${tile.tone} ${tile.span}`} key={tile.symbol} style={{ animationDelay: `${index * 130}ms` }}>
              <div className="flex items-start justify-between gap-3">
                <div className="landing-tile-label">{tile.label}</div>
                <SymbolLogo
                  className="market-tile__logo"
                  metadata={symbolMetadata[tile.symbol]}
                  symbol={tile.symbol}
                />
              </div>
              <div className="mt-auto text-xl font-semibold">{tile.symbol}</div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

export default function HomePage() {
  const { user, isLoading } = useSession();
  const [metadataRows, setMetadataRows] = useState<AlphaSymbolMetadata[]>([]);
  const [copiedDeployCommand, setCopiedDeployCommand] = useState(false);
  const appHref = user ? "/dashboard" : "/auth/sign-in";
  const heroCtaLabel = !isLoading && user ? "Enter Console" : "Start Self-Hosted";
  const symbolMetadata = useMemo(
    () => metadataRows.reduce<Record<string, AlphaSymbolMetadata>>((acc, item) => {
      acc[item.symbol.toUpperCase()] = item;
      return acc;
    }, {}),
    [metadataRows]
  );

  useEffect(() => {
    let cancelled = false;
    getAlphaSymbolMetadata(landingSymbols)
      .then((metadata) => {
        if (!cancelled) setMetadataRows(metadata);
      })
      .catch(() => {
        if (!cancelled) setMetadataRows([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const copyDeployCommand = async () => {
    await navigator.clipboard.writeText(deployCommand);
    setCopiedDeployCommand(true);
    window.setTimeout(() => setCopiedDeployCommand(false), 1600);
  };

  return (
    <main className="landing-page">
      <nav className="landing-nav fixed left-0 top-0 z-50 w-full backdrop-blur-md">
        <div className="flex h-16 w-full items-center justify-between px-5">
          <BrandLogo imageClassName="landing-logo h-8 w-auto" />
          <div className="flex items-center gap-3">
            <div className="landing-theme-toggle">
              <ThemeToggle />
            </div>
            <Link
              href="https://github.com/manasijatech/Market-Stack"
              target="_blank"
              rel="noreferrer"
              className="landing-nav-link hidden items-center gap-2 px-3 py-2 font-mono text-xs transition sm:flex"
            >
              <IconBrandGithub className="size-4" />
              GitHub
            </Link>
            {user ? (
              <Link
                href="/dashboard"
                className="landing-primary-button flex items-center gap-2 px-4 py-2 font-mono text-xs font-semibold transition"
              >
                Open Console
                <ArrowRight className="size-4" />
              </Link>
            ) : (
              <>
                <Link
                  href="/auth/sign-in"
                  className="landing-nav-link flex items-center gap-2 px-3 py-2 font-mono text-xs transition"
                >
                  Sign in
                </Link>
                <Link
                  href="/auth/sign-up"
                  className="landing-primary-button flex items-center gap-2 px-4 py-2 font-mono text-xs font-semibold transition"
                >
                  Sign up
                  <ArrowRight className="size-4" />
                </Link>
              </>
            )}
          </div>
        </div>
      </nav>

      <section className="landing-hero-section relative overflow-hidden">
        <LiquidityHeroScene symbolMetadata={symbolMetadata} />
        <div className="landing-hero-inner relative z-10 mx-auto flex max-w-7xl items-center px-5">
          <div className="landing-hero-copy-zone max-w-3xl">
            <div className="landing-chip landing-hero-chip inline-flex items-center gap-2 px-3 py-2 font-mono text-xs uppercase backdrop-blur">
              <Zap className="size-4" />
              Self-hosted trading control plane
            </div>
            <h1 className="landing-hero-title max-w-4xl font-semibold leading-[1.04]">
              <span className="hero-text-scrim">Market workflows that run where your edge lives.</span>
            </h1>
            <p className="landing-hero-copy max-w-2xl leading-7">
              <span className="hero-copy-scrim">
                Connect Indian broker accounts, stream market data, build alert workflows, and add LLM analysis inside
                a private open-source workspace you control.
              </span>
            </p>
            <div className="landing-hero-actions flex flex-wrap items-center gap-3">
              <Link
                href={appHref}
                className="landing-primary-button flex min-h-12 items-center gap-2 px-5 font-mono text-sm font-semibold transition"
              >
                {heroCtaLabel}
                <ArrowRight className="size-4" />
              </Link>
              <Link
                href="#self-host"
                className="landing-secondary-button flex min-h-12 items-center gap-2 px-5 font-mono text-sm backdrop-blur transition"
              >
                <Route className="size-4" />
                See The Stack
              </Link>
            </div>
            <div className="landing-proof landing-hero-proof grid max-w-2xl gap-3 font-mono text-xs sm:grid-cols-3">
              <span className="flex items-center gap-2"><Lock className="size-4" /> encrypted secrets</span>
              <span className="flex items-center gap-2"><Activity className="size-4" /> live alert workers</span>
              <span className="flex items-center gap-2"><Server className="size-4" /> Docker deployable</span>
            </div>
          </div>
        </div>
        <TickerTape symbolMetadata={symbolMetadata} />
      </section>

      <BrokerSignalMap />

      <WorkflowTimeline />
      <MarketHeatmap symbolMetadata={symbolMetadata} />

      <section id="self-host" className="landing-section self-host-section">
        <div className="self-host-shell mx-auto grid max-w-7xl gap-10 min-[980px]:grid-cols-[0.95fr_1.05fr] min-[980px]:items-center">
          <div className="self-host-copy">
            <p className="landing-eyebrow">Why self-host</p>
            <h2 className="mt-4 max-w-3xl text-3xl font-semibold leading-tight md:text-4xl">
              Your positions, watchlists, prompts, and alert logic should not be vendor telemetry.
            </h2>
            <p className="landing-copy mt-5 max-w-2xl text-sm leading-6 md:text-base">
              Market Stack is meant to be a foundation: open-source core, private deployments, managed options for
              teams, and implementation support when a desk needs custom integrations.
            </p>
            <div className="self-host-proof mt-7">
              <span>
                <Image src="/brand/tech/docker.png" alt="" width={18} height={18} className="object-contain" />
                Docker Compose
              </span>
              <span>
                <Image src="/brand/tech/sqlitebrowser.png" alt="" width={18} height={18} className="object-contain" />
                local secrets
              </span>
              <span>
                <Image src="/brand/tech/python.png" alt="" width={18} height={18} className="object-contain" />
                Python workers
              </span>
              <span>
                <Image src="/brand/tech/fastapi.png" alt="" width={18} height={18} className="object-contain" />
                FastAPI
              </span>
              <span>
                <Image src="/brand/tech/nextjs.png" alt="" width={18} height={18} className="object-contain" />
                Next JS
              </span>
              <span>
                <Image src="/brand/tech/redis.png" alt="" width={18} height={18} className="object-contain" />
                Redis
              </span>
            </div>
            <div className="mt-8 flex flex-wrap gap-3">
              <Link
                href="https://github.com/manasijatech/Market-Stack"
                target="_blank"
                rel="noreferrer"
                className="landing-source-button flex min-h-12 items-center gap-2 px-5 font-mono text-sm transition"
              >
                <IconBrandGithub className="size-4" />
                View Source
              </Link>
              <Link
                href={appHref}
                className="landing-contrast-button flex min-h-12 items-center gap-2 px-5 font-mono text-sm font-semibold transition"
              >
                Open Workspace
                <ArrowRight className="size-4" />
              </Link>
            </div>
          </div>

          <div className="deploy-command-panel">
            <div className="deploy-command-head">
              <span className="deploy-command-label">bash</span>
              <button className="deploy-copy-button" type="button" onClick={copyDeployCommand}>
                {copiedDeployCommand ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
                {copiedDeployCommand ? "Copied" : "Copy"}
              </button>
            </div>
            <pre className="deploy-command overflow-x-auto font-mono text-sm leading-7">
              <code>{deployCommand}</code>
            </pre>
          </div>
        </div>
      </section>

      <footer className="landing-footer px-5 py-8">
        <div className="mx-auto flex max-w-7xl flex-col gap-4 text-xs sm:flex-row sm:items-center sm:justify-between">
          <BrandLogo imageClassName="landing-logo h-6 w-auto opacity-70" />
          <span className="font-mono">Open-source core for broker-connected market workflows.</span>
        </div>
      </footer>
    </main>
  );
}
