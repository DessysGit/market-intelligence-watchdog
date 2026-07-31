# Market Intelligence Watchdog

An automated, zero-cost pipeline that tracks a competitor's website daily,
detects meaningful changes, and sends a plain-language summary to Telegram.

Started from a blueprint concept; several parts were adapted after real
testing surfaced issues the original design didn't anticipate. Below
reflects what's actually been built and validated, not the original plan.

## Architecture

| Stage | Tool | Status |
|---|---|---|
| Trigger | GitHub Actions (daily cron) | ✅ Wired up, tested via manual trigger |
| Fetch | Jina AI Reader (`r.jina.ai`) | ✅ Validated |
| Clean | Custom regex cleaner (strips markdown noise) | ✅ Validated |
| Diff | `diff` npm package (`diffLines`), computed in code | ✅ Validated |
| Summarize | Google Gemini 3.5 Flash | ✅ Validated |
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
- Go to Google AI Studio → Get API Key (check current free-tier model —
  this project used `gemini-1.5-flash` during initial development, moved to
  `gemini-2.0-flash`, and now runs on `gemini-3.5-flash` after two rounds of
  deprecation; the free-tier lineup has moved fast in 2026, so verify the
  current model name in AI Studio before assuming this stays accurate)

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

## Resolved since initial build
- **AI-unavailable resilience**: if Gemini fails (rate limit, outage), the
  pipeline no longer fails silently or leaves the Neon snapshot stale. The
  Gemini call is isolated in its own try/catch — a failure there still lets
  today's snapshot save to Neon (so tomorrow's diff compares against today,
  not a days-old snapshot), and if real changes were detected but couldn't
  be summarized, a fallback Telegram alert reports the raw added/removed
  line counts so you know to check manually. The whole pipeline body also
  now runs inside a try/finally so the Neon connection always closes
  cleanly, even if an earlier step (e.g. Jina fetch) throws first.
- **Real target selected**: `wealth.ic.africa/fixed-income` (IC Wealth, a
  legitimate Ghanaian investment platform — verified against a lookalike
  scam site using a similar name before picking this one). Replaced the
  Brevo.com test target used during development.
- **Neon vs Supabase**: settled on Neon (plain Postgres via the `pg`
  client) to avoid disrupting existing Supabase projects. `index.js` fully
  migrated off the Supabase SDK.
- **Gemini model**: updated from `gemini-1.5-flash` (validated during
  development, since discontinued) through `gemini-2.0-flash` (deprecated
  June 2026) to `gemini-3.5-flash`, the current free-tier model as of
  mid-2026. Worth periodically checking Google AI Studio for whether this
  is still the correct free-tier model, since this lineup has moved fast.

## Known limitations / open items
- Target currently tracks a single URL — loop `runWatchdog()` over an
  array of URLs to monitor multiple competitors
- `diffLines` diffs whole lines, not words — a one-word change inside a
  long paragraph will surface the entire line as changed. Fine for
  summaries, worth revisiting (`diffWords`) if paragraphs get long on real
  target sites
- Not yet tested against a site with dynamic/rotating content — the IC
  Wealth homepage has a retirement calculator with fields that may render
  differently per fetch even with no real content change (flagged as a
  possible noise source, not yet confirmed as an actual problem)
- The `/fixed-income` page was chosen over the homepage on the theory that
  rate/product changes are more likely there than in marketing copy — not
  yet confirmed with a real multi-day run
- Not yet running on a real daily cadence long enough to confirm the
  8 AM UTC schedule fires reliably day after day without supervision —
  **update: confirmed over several consecutive days, cron fires reliably
  and correctly skips the alert on no-change days**

## Testing scripts
Standalone test scripts used during development, kept for reference /
future debugging of individual pipeline stages:
- `test-jina.js` — fetch + save raw Jina output
- `clean-content.js` — run the content cleaner against a saved file
- `test-telegram.js` — send a standalone Telegram test alert
- `test-neon.js` — verify Neon connection, upsert, and read

See `prompts.md` for the full history of prompt iterations and why the
final diff-based approach was chosen.