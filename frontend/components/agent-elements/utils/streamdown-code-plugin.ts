import type { ComponentProps } from "react";
import { createCodePlugin } from "@streamdown/code";
import type { Streamdown } from "streamdown";

type StreamdownCodePlugin = NonNullable<
  NonNullable<ComponentProps<typeof Streamdown>["plugins"]>["code"]
>;

// @streamdown/code bundles shiki@3 while @pierre/diffs pulls shiki@4; their
// CodeHighlighterPlugin types diverge on BundledLanguage. Runtime is fine.
export const streamdownCodePlugin = createCodePlugin({
  themes: ["github-light", "github-dark"],
}) as StreamdownCodePlugin;
