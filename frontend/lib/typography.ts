/**
 * shadcn/ui typography utilities (radix-nova).
 * @see https://ui.shadcn.com/docs/components/radix/typography
 */
export const typography = {
    h1: "scroll-m-20 text-4xl font-extrabold tracking-tight text-balance lg:text-5xl",
    h2: "scroll-m-20 border-b pb-2 text-3xl font-semibold tracking-tight first:mt-0",
    h3: "scroll-m-20 text-2xl font-semibold tracking-tight",
    h4: "scroll-m-20 text-xl font-semibold tracking-tight",
    p: "leading-7 [&:not(:first-child)]:mt-6",
    lead: "text-xl leading-7 text-muted-foreground",
    large: "text-lg font-semibold",
    small: "text-sm leading-none font-medium",
    muted: "text-sm text-muted-foreground",
    eyebrow: "text-sm font-medium text-muted-foreground",
    inlineCode:
        "relative rounded bg-muted px-[0.3rem] py-[0.2rem] font-mono text-sm font-semibold",
    blockquote: "mt-6 border-l-2 pl-6 italic",
    list: "my-6 ml-6 list-disc [&>li]:mt-2"
} as const;
