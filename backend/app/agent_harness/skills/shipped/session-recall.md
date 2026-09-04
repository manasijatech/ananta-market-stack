---
id: session-recall
name: Session recall
description: "Use when: user asks what we said earlier in this chat, or you need a prior number/symbol after compaction. Do not use when: they want live market data — re-fetch instead."
version: 1
tools: [session_search, session_expand]
triggers: [keyword:earlier, keyword:what did we, keyword:in this chat, keyword:you said]
---

# Recall from this chat

## Goal
Recover facts from **this session** without inventing them.

## Steps
1. Call `session_search` with a short query (example: `query="Gabriel margin", limit=5, window=0`).
2. If the snippet is thin for a number the user will act on, `session_expand` once or twice.
3. Prefer re-fetching live quotes/news over trusting a compaction summary alone.
4. If search returns nothing, say you cannot find it in this chat.

## Cannot
- Invent prior figures when search is empty.
- Use session recall as a substitute for `broker_get_quotes` / news tools.
- Expand more than twice per turn when still truncated — re-fetch the source.
