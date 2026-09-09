---
id: open-web-news
name: Open-web news
description: "Use when: user asks for recent news/headlines from the public web or a named outlet. Do not use when: MCP news tools are connected and can answer — prefer MCP first."
version: 1
tools: [web_search, web_fetch]
triggers: [keyword:news, keyword:headline, keyword:what happened]
---

# Open-web news budget

## Goal
Get a usable news brief without search loops.

## Steps
1. Prefer connected MCP news/daily summary tools when available.
2. Otherwise `web_search` at most **twice** (one query, one refinement). Example: `query="Infosys Q1 results site:economictimes.indiatimes.com"`.
3. `web_fetch` the best **1–3** URLs. Stop when you have titles, dates, and a few facts.
4. Write a short briefing with source names (Economic Times, Mint, …) — not tool ids.

## Cannot
- Keep searching after you already have usable titles/URLs.
- Claim a login-walled page was read; say it is not readable and continue.
- Dump crawler/search-engine internals in the user answer.
