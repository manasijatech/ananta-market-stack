/**
 * shadcn/ui typography utilities (radix-nova).
 * @see https://ui.shadcn.com/docs/components/radix/typography
 */
export const typography = {
    // Headings — heading font (Rethink Sans), bold, with tracking that tightens
    // as size grows (larger display = tighter letterspacing).
    h1: "scroll-m-20 font-heading text-4xl font-bold tracking-tighter text-balance lg:text-5xl",
    h2: "scroll-m-20 font-heading border-b pb-2 text-3xl font-bold tracking-tight first:mt-0",
    h3: "scroll-m-20 font-heading text-2xl font-bold tracking-tight",
    h4: "scroll-m-20 font-heading text-xl font-semibold tracking-tight",
    p: "leading-7 [&:not(:first-child)]:mt-6",
    lead: "text-xl leading-7 text-muted-foreground",
    large: "font-heading text-lg font-semibold tracking-tight",
    small: "text-sm leading-none font-medium",
    muted: "text-sm text-muted-foreground",
    eyebrow: "text-sm font-medium text-muted-foreground",
    /** Workspace page chrome — eyebrow above the title */
    pageEyebrow: "text-xs font-medium text-muted-foreground",
    /** Workspace page chrome — primary page title */
    pageTitle: "font-heading text-[22px] font-bold tracking-tight text-foreground text-balance",
    /** Workspace page chrome — subtitle below the title */
    pageLead: "mt-2 max-w-2xl text-[13px] leading-relaxed text-muted-foreground",
    /** Section label (e.g. MEMBERS, BROKER ACCOUNTS) */
    sectionEyebrow: "text-[11px] font-medium uppercase tracking-[0.07em] text-muted-foreground",
    /** Compact uppercase label for stat cards and filter fields */
    statLabel: "text-[11px] font-medium uppercase tracking-[0.05em] text-muted-foreground",
    /** Section heading within a page */
    sectionTitle: "font-heading text-[15px] font-semibold tracking-tight text-foreground",
    /** Section description within a page */
    sectionLead: "text-[13px] text-muted-foreground",
    inlineCode:
        "relative rounded bg-muted px-[0.3rem] py-[0.2rem] font-mono text-sm font-semibold",
    blockquote: "mt-6 border-l-2 pl-6 italic",
    list: "my-6 ml-6 list-disc [&>li]:mt-2"
} as const;
