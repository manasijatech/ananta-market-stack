import Link from "next/link";
import {
 ArrowDownRight,
 ArrowUpRight,
 Bell,
 Bot,
 Gauge,
 GitBranch,
 IndianRupee,
 Layers,
 Megaphone,
 Radio,
 Target,
 TrendingDown,
 TrendingUp,
 type LucideIcon
} from "lucide-react";
import { getAlertTemplates } from "@/service/actions/alerts";
import type { AlertTemplate } from "@/service/types/alerts";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

type TemplateIdentity = {
 accent: string;
 icon: LucideIcon;
 label: string;
 motif: "breakout" | "feed" | "gap" | "options" | "price" | "reversal" | "momentum";
 signal: string;
};

const identityByCategory: Record<string, TemplateIdentity> = {
 breakout: {
  accent: "#1F8A70",
  icon: TrendingUp,
  label: "Breakout",
  motif: "breakout",
  signal: "Range breach"
 },
 options: {
  accent: "#6F42C1",
  icon: Layers,
  label: "Options",
  motif: "options",
  signal: "OI expansion"
 },
 "alpha-feed": {
  accent: "#B8780A",
  icon: Radio,
  label: "Alpha feed",
  motif: "feed",
  signal: "Feed trigger"
 },
 gap: {
  accent: "#0D6EFD",
  icon: ArrowUpRight,
  label: "Gap",
  motif: "gap",
  signal: "Opening impulse"
 },
 reversal: {
  accent: "#C62828",
  icon: TrendingDown,
  label: "Reversal",
  motif: "reversal",
  signal: "Failed follow-through"
 },
 momentum: {
  accent: "#2E7D32",
  icon: Gauge,
  label: "Momentum",
  motif: "momentum",
  signal: "Rolling move"
 },
 price: {
  accent: "#17A2B8",
  icon: Target,
  label: "Price",
  motif: "price",
  signal: "Level cross"
 }
};

const fallbackIdentity: TemplateIdentity = {
 accent: "#8A8278",
 icon: Bell,
 label: "Template",
 motif: "price",
 signal: "Workflow signal"
};

function getTemplateIdentity(template: AlertTemplate): TemplateIdentity {
 const category = template.category.toLowerCase();
 const slug = template.slug.toLowerCase();
 const name = template.name.toLowerCase();

 if (category.includes("alpha") || slug.includes("feed") || name.includes("feed")) return identityByCategory["alpha-feed"];
 if (slug.includes("order") || name.includes("order")) return { ...identityByCategory["alpha-feed"], icon: Megaphone, signal: "LLM event scan" };
 if (category.includes("option") || slug.includes("oi") || name.includes("oi")) return identityByCategory.options;
 if (category.includes("gap") || slug.includes("gap")) return identityByCategory.gap;
 if (category.includes("reversal") || slug.includes("reversal")) return identityByCategory.reversal;
 if (category.includes("momentum") || slug.includes("percentage") || name.includes("percentage")) return identityByCategory.momentum;
 if (category.includes("price") || slug.includes("price-cross") || name.includes("price cross")) return identityByCategory.price;
 if (slug.includes("earnings") || name.includes("earnings")) return { ...identityByCategory["alpha-feed"], icon: IndianRupee, signal: "Earnings surprise" };
 if (category.includes("breakout") || slug.includes("breakout") || name.includes("breakout")) return identityByCategory.breakout;
 return fallbackIdentity;
}

function getTemplateStats(template: AlertTemplate) {
 const dsl = template.workflow_dsl;
 const products = dsl.feed_trigger?.products ?? [];
 const channels = dsl.channels?.enabled ?? [];
 const nodes = template.graph_dsl?.nodes ?? [];
 const cooldownMinutes = Math.round((dsl.cooldown_seconds ?? 0) / 60);

 return [
  dsl.workflow_type === "alpha_feed" ? "Alpha feed" : "Market data",
  products.length ? `${products.length} products` : `${dsl.conditions.length} conditions`,
  cooldownMinutes ? `${cooldownMinutes}m cooldown` : "No cooldown",
  channels.length ? `${channels.length} channels` : `${nodes.length} graph nodes`
 ];
}

function SignalMotif({ identity }: { identity: TemplateIdentity }) {
 const bars = identity.motif === "reversal" ? [82, 62, 42, 28] : identity.motif === "gap" ? [35, 38, 74, 88] : identity.motif === "options" ? [44, 78, 56, 90] : [38, 52, 70, 84];

 return (
 <div className="flex h-16 items-end gap-1.5" aria-hidden="true">
 {bars.map((height, index) => (
 <span
 className="w-2 border border-current bg-current/10"
 key={`${identity.motif}-${index}`}
 style={{ height: `${height}%`, color: identity.accent, opacity: 0.55 + index * 0.1 }}
 />
 ))}
 {identity.motif === "price" ? <Target className="mb-1 size-5" style={{ color: identity.accent }} /> : null}
 {identity.motif === "feed" ? <Bot className="mb-1 size-5" style={{ color: identity.accent }} /> : null}
 {identity.motif === "reversal" ? <ArrowDownRight className="mb-1 size-5" style={{ color: identity.accent }} /> : null}
 </div>
 );
}

function TemplateCard({ template }: { template: AlertTemplate }) {
 const identity = getTemplateIdentity(template);
 const Icon = identity.icon;
 const stats = getTemplateStats(template);

 return (
 <Card className="group relative min-h-[236px] overflow-hidden py-0 transition-colors hover:border-primary/60">
 <div className="absolute inset-y-0 left-0 w-1.5" style={{ backgroundColor: identity.accent }} aria-hidden="true" />
 <CardContent className="grid h-full gap-5 p-5 pl-7 min-[760px]:grid-cols-[1fr_auto]">
 <div className="flex min-w-0 flex-col">
 <div className="flex flex-wrap items-center gap-2">
 <span className="flex size-9 items-center justify-center border border-border bg-background" style={{ color: identity.accent }}>
 <Icon className="size-4.5" />
 </span>
 <span className="type-step-eyebrow" style={{ color: identity.accent }}>{identity.label}</span>
 </div>
 <h2 className="mt-4 max-w-full break-words text-lg font-semibold leading-6 text-foreground">{template.name}</h2>
 <p className="mt-4 max-w-2xl break-words text-sm leading-6 text-muted-foreground">{template.description}</p>
 <div className="mt-5 flex flex-wrap gap-2">
 {stats.map((stat) => (
 <span className="border border-border bg-background/60 px-2.5 py-1 font-mono text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground" key={stat}>
 {stat}
 </span>
 ))}
 </div>
 <div className="mt-5">
 <Button asChild type="button">
 <Link href={`/alerts/workflows/new?template=${template.id}`}>Use template</Link>
 </Button>
 </div>
 </div>
 <div className="flex min-w-40 flex-col justify-between border-l border-border pl-5">
 <div>
 <div className="type-step-eyebrow">Signal</div>
 <div className="mt-2 text-sm font-semibold leading-5 text-foreground">{identity.signal}</div>
 </div>
 <SignalMotif identity={identity} />
 <div className="flex items-center gap-2 text-xs text-muted-foreground">
 <GitBranch className="size-3.5" />
 <span>{template.graph_dsl.nodes.length} nodes</span>
 </div>
 </div>
 </CardContent>
 </Card>
 );
}

export default async function AlertTemplatesPage() {
 const templates = await getAlertTemplates();

 return (
 <section className="grid gap-4 min-[1100px]:grid-cols-2">
 {templates.map((template) => (
 <TemplateCard key={template.id} template={template} />
 ))}
 </section>
 );
}
