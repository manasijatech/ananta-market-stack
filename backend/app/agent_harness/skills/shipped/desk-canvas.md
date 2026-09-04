---
id: desk-canvas
name: Desk canvas
description: "Use when: user wants a visual desk, briefing canvas, or 'show this on the board'. Do not use when: a one-line quote answer is enough — answer in chat first."
version: 1
tools: [compose_surface, patch_surface, workspace_publish_html_artifact, workspace_update_html_artifact]
triggers: [keyword:canvas, keyword:desk, keyword:visualize, keyword:on the board]
---

# Desk vs Canvas

## Goal
Chat answers first; the canvas visualizes the same facts.

## Steps
1. Fetch real data (quotes, news, holdings) before composing.
2. Live broker data → first-party widgets (`quote-ticker`, `quote-chart`, `intel-feed`, …).
3. Themed briefing / timeline / snapshot of **already fetched** facts → `html-artifact` via `workspace_publish_html_artifact` (kit classes only). Example: publish a short Gabriel pulse with an inline `{{ltp:NSE:GABRIEL|…}}` token.
4. Evolve an existing canvas with `workspace_update_html_artifact` instead of stacking duplicates.
5. After compose, finish the **analysis** in chat — do not dump widget ids or a Gaps appendix.

## Cannot
- Emit React/CSS/script on first-party widgets.
- Paste huge raw HTML into `compose_surface` when publish already wraps the kit.
- Treat compose as a substitute for answering the question.
