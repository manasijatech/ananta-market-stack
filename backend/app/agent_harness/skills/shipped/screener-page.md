---
id: screener-page
name: Screener page
description: "Use when: user pastes a Screener.in / NSE / BSE / filing URL or asks to read fundamentals from a page. Do not use when: they only want a live LTP (use broker quotes / islands)."
version: 1
tools: [web_fetch, sandbox_run_python, workspace_publish_html_artifact]
triggers: [url:screener.in, url:nseindia.com, url:bseindia.com, keyword:screener]
---

# Screener / filing page

## Goal
Open the pasted page, extract **stated** figures only, compute ratios in the calculator when needed, and brief the user. Never invent numbers from memory.

## Steps
1. Call `web_fetch` with the exact URL the user pasted (example: `url="https://www.screener.in/company/INFY/consolidated/"`).
2. Pull only figures that appear on the page (sales, PAT, margins, PE, etc.). Quote units as written.
3. If CAGR / splits / scenario math is needed and `sandbox_run_python` is attached, run it — do not mental-math material numbers.
4. Answer in chat with a short takeaway + the key table. Optionally publish one html-artifact Canvas for the snapshot.
5. For **spot** prices today, use broker quotes and `{{ltp:…}}` islands — do not scrape LTP from Screener as live.

## Cannot
- Log into paid Screener pages or bypass paywalls.
- Invent FY/quarter figures that were not on the fetched page.
- Loop `web_search` after a successful fetch of the pasted URL.
