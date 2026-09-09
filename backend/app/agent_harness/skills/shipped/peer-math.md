---
id: peer-math
name: Peer math
description: "Use when: user asks CAGR, split-adjusted returns, relative performance, or multi-period peer math. Do not use when: they only want today's LTP / day %."
version: 1
tools: [sandbox_run_python, broker_get_historical, broker_get_quotes]
triggers: [keyword:cagr, keyword:compound, keyword:peer, keyword:split-adjusted]
---

# Peer / compounding math

## Goal
Compare returns or compounding with **calculator evidence**, not mental math.

## Steps
1. Fetch the series you need (`broker_get_historical` or workspace OHLC paths when sandbox is attached).
2. If `sandbox_run_python` is attached: load data from workspace paths, compute in stdlib, print the comparison. Example: load two OHLC series and print CAGR and total return.
3. If sandbox is **not** attached (OSS): show the formula and arithmetic steps inline from the numbers you fetched — still do not invent closes.
4. Put the answer in chat; optional Canvas table for the peer set.

## Cannot
- Invent candle closes or CAGR from memory.
- Type large OHLC arrays into sandbox code — load from workspace paths when available.
- Skip the calculator when sandbox is attached and the user asked for CAGR/splits.
