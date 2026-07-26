# Market Intelligence Watchdog

An automated, zero-cost pipeline that tracks a competitor's website daily,
detects meaningful changes, and sends a plain-language summary to Telegram.

Started from a blueprint concept; several parts were adapted after real
testing surfaced issues the original design didn't anticipate. Below
reflects what's actually been built and validated, not the original plan.

## Architecture

| Stage | Tool | Status |
|---|---|---|
| Trigger | GitHub Actions (daily cron) | Not yet wired up |
| Fetch | Jina AI Reader (`r.jina.ai`) | ✅ Validated |
| Clean | Custom regex cleaner (strips markdown noise) | ✅ Validated |
| Diff | `diff` npm package (`diffLines`), computed in code | ✅ Validated |
| Summarize | Google Gemini 1.5 Flash | ✅ Validated |
| Store | Neon (Postgres) | ✅ Validated |
| Alert | Telegram Bot API (HTML formatting) | ✅ Validated |

## Key adaptations from the original blueprint

**1. Change detection moved from the LLM into code.**
The original design asked Gemini to compare two full snapshots and describe
what changed. Testing showed Gemini reliably *detects* that something
changed, but repeatedly gets the *direction* backwards (e.g. reporting a
customer count that increased as a decrease, a feature that was added as
removed) — reproduced 3/3 times, even with explicit "older vs newer"
instructions in the prompt. Since a watchdog's entire value is telling a
business owner what a competitor actually *did*, a backwards report is worse
than no report at all.

Fix: a code-level line diff (`diffLines`) now computes added/removed content
deterministically. Gemini's only job is to explain an already-directional,
pre-labeled list — it never has to reason about which snapshot came first.
See `computeDiff()` and `prompts.md` for details.

**2. Content is cleaned before being sent to the LLM.**
Raw Jina output on a real marketing site (tested against brevo.com) is
roughly 68% markdown link/image noise and repeated nav-menu text. A cleaning
pass strips this before diffing and summarizing — both cheaper (fewer tokens)
and avoids padding the diff with cookie-banner boilerplate.

**3. "No changes" alerts are skipped entirely, and skip the API call too.**
If the code-level diff finds zero added/removed lines, the pipeline never
calls Gemini and never sends a Telegram message — it just logs and exits.
This avoids the daily-noise problem of a "nothing happened" ping training you
to ignore the bot, and saves Gemini API quota on quiet days.

**4. Neon instead of Supabase.**
Functionally equivalent (both free-tier Postgres), swapped to avoid
disrupting existing projects already running on Supabase. Uses the plain
`pg` client instead of the Supabase SDK — plain SQL queries, no ORM layer.

**5. Telegram alerts use HTML formatting, not Markdown.**
Telegram's legacy Markdown parser throws opaque "can't parse entities"
errors on ordinary punctuation near formatting characters (e.g. `*Target:*`
with a colon). HTML (`<b>`, `<i>`, etc.) doesn't have this problem since it
only reacts to actual tags.

## Setup

### 1. Telegram bot
- Message `@BotFather` on Telegram, run `/newbot`, save the bot token
- Message your new bot once (e.g. `/start`) so it can see your chat
- Visit `https://api.telegram.org/bot<TOKEN>/getUpdates` to find your `chat_id`

### 2. Gemini API key
- Go to Google AI Studio → Get API Key (free tier, Gemini 1.5 Flash)

### 3. Neon database
- Create a project at neon.tech, copy the connection string
- Run in the SQL editor:
```sql
create table competitor_snapshots (
  id bigint generated always as identity primary key,
  url text not null unique,
  last_content text,
  updated_at timestamptz default now()
);
```

### 4. Environment variables
```
TELEGRAM_BOT_TOKEN=
TELEGRAM_CHAT_ID=
GEMINI_API_KEY=
DATABASE_URL=
```

### 5. Install dependencies
```
npm install node-fetch pg diff
```
Add `"type": "module"` to `package.json` (project uses ES module `import` syntax).

## Known limitations / open items
- Not yet wired into GitHub Actions — currently runs manually via `node index.js`
- `diffLines` diffs whole lines, not words — a one-word change inside a long
  paragraph will surface the entire line as changed. Fine for summaries,
  worth revisiting (`diffWords`) if paragraphs get long on real target sites
- Not yet tested against a site with dynamic/rotating content (e.g. a
  reshuffling product carousel) — could produce noisy false-positive diffs
- Target URL is currently hardcoded (`brevo.com`, used for testing) —
  swap to real competitor target(s) before automating
- `dbError` from the snapshot lookup is logged but not yet distinguished
  between "no row yet" (expected on first run) vs. an actual connection
  failure — worth tightening before trusting this unattended

## Testing scripts
Standalone test scripts used during development, kept for reference /
future debugging of individual pipeline stages:
- `test-jina.js` — fetch + save raw Jina output
- `clean-content.js` — run the content cleaner against a saved file
- `test-telegram.js` — send a standalone Telegram test alert
- `test-neon.js` — verify Neon connection, upsert, and read

See `prompts.md` for the full history of prompt iterations and why the
final diff-based approach was chosen.