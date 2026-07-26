import 'dotenv/config';
import fetch from 'node-fetch';
import pg from 'pg';
const { Client } = pg;
import { diffLines } from 'diff';

// Configuration
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const DATABASE_URL = process.env.DATABASE_URL;

// 1. Fetch Clean Web Content via Jina AI
async function fetchWebContent(targetUrl) {
  const jinaUrl = `https://r.jina.ai/${targetUrl}`;
  const response = await fetch(jinaUrl);
  if (!response.ok) {
    throw new Error(`Jina fetch failed for ${targetUrl}: ${response.status}`);
  }
  return await response.text();
}

// 1b. Strip markdown link/image noise from Jina output before it hits the LLM.
// Validated against a real nav-heavy marketing site (Brevo): cut ~68% of chars
// (30k -> ~9.7k) while Gemini still correctly ignored the remaining nav labels
// when instructed to.
function cleanContent(text) {
  return text
    .replace(/!\[.*?\]\(.*?\)/g, '')            // strip markdown images
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')     // strip markdown links, keep text
    .replace(/\n{3,}/g, '\n\n')                  // collapse excess blank lines
    .replace(/^\*\s*$/gm, '')                    // drop empty bullet lines
    .trim();
}

// 1c. Compute a deterministic, directional diff between snapshots in code.
//
// WHY THIS EXISTS (important — do not remove and go back to asking the LLM
// to compare two full snapshots itself):
// Testing showed Gemini 1.5 Flash reliably DETECTS that something changed,
// but repeatedly gets the DIRECTION backwards — e.g. reporting a stat that
// increased (600k -> 750k) as a decrease, and a feature that was ADDED as
// REMOVED. This happened consistently even with explicit "PREVIOUS = older,
// CURRENT = newer" instructions repeated in the prompt. Since a watchdog's
// entire value is telling a business owner what a competitor just DID
// (raised prices? added a feature?), a backwards report is worse than no
// report. Doing the diff in code removes the ambiguity entirely — the LLM
// is only ever asked to explain a pre-labeled, pre-sorted list of
// added/removed lines, never to reason about which snapshot came first.
function computeDiff(previousContent, currentContent) {
  const changes = diffLines(previousContent, currentContent);
  const added = changes.filter(c => c.added).map(c => c.value.trim()).filter(Boolean);
  const removed = changes.filter(c => c.removed).map(c => c.value.trim()).filter(Boolean);
  return { added, removed };
}

// 2. Analyze a pre-computed diff using Gemini API
// Gemini's job here is ONLY to turn an already-directional diff into a
// readable summary — not to detect changes or reason about order itself.
async function analyzeWithAI(added, removed) {
  if (added.length === 0 && removed.length === 0) {
    return 'No major changes detected.';
  }

  const prompt = `
You are summarizing pre-computed changes to a competitor's webpage for a business owner.
These lists were computed by a diff tool, not by you — the direction is already correct.
Do not re-derive or second-guess which item is older or newer; just explain what they mean.

LINES ADDED (new in the latest version — did not exist before):
${added.join('\n---\n') || '(none)'}

LINES REMOVED (existed before, no longer present):
${removed.join('\n---\n') || '(none)'}

Give a 3-bullet executive summary of what these additions/removals mean for the business.
Focus on pricing, features, stats, and campaigns. For each bullet, state explicitly whether
the item was ADDED or REMOVED, using those exact words. Ignore anything that looks like
navigation menu text, cookie-banner text, or footer links — focus only on substantive content.
`;

  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash:generateContent?key=${GEMINI_API_KEY}`;
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }]
    })
  });

  const data = await response.json();
  if (!data.candidates || !data.candidates[0]) {
    throw new Error(`Gemini API returned no candidates: ${JSON.stringify(data)}`);
  }
  return data.candidates[0].content.parts[0].text;
}

// 3. Send Telegram Alert
// Uses HTML parse_mode instead of Markdown — tested and confirmed Telegram's
// legacy Markdown parser throws "can't parse entities" errors on messages
// with colons/periods near asterisks (e.g. "*Target:*"). HTML only cares
// about actual tags, so it doesn't collide with normal punctuation in alert text.
async function sendTelegramAlert(message) {
  const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;
  await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: TELEGRAM_CHAT_ID,
      text: message,
      parse_mode: 'HTML'
    })
  });
}

// Main Execution Flow
async function runWatchdog(targetUrl) {
  console.log(`Checking ${targetUrl}...`);

  const client = new Client({ connectionString: DATABASE_URL });
  await client.connect();

  // Get previous snapshot from Neon.
  const result = await client.query(
    `select last_content from competitor_snapshots where url = $1`,
    [targetUrl]
  );
  const previousContent = result.rows[0] ? result.rows[0].last_content : '';

  const rawContent = await fetchWebContent(targetUrl);
  const currentContent = cleanContent(rawContent);

  // Compute the diff in code — see computeDiff() comment for why.
  const { added, removed } = computeDiff(previousContent, currentContent);

  const summary = await analyzeWithAI(added, removed);

  const noChange = summary.trim().toLowerCase().startsWith('no major changes detected');

  if (!noChange) {
    const alertText = `🚨 <b>Market Watchdog Alert</b>\n\n<b>Target:</b> ${targetUrl}\n\n<b>Insights:</b>\n${summary}`;
    await sendTelegramAlert(alertText);
  } else {
    console.log('No major changes detected — skipping alert.');
  }

  // Upsert current snapshot to Neon regardless, so tomorrow's diff is fresh
  await client.query(
    `insert into competitor_snapshots (url, last_content, updated_at)
     values ($1, $2, now())
     on conflict (url) do update set last_content = excluded.last_content, updated_at = now()`,
    [targetUrl, currentContent.substring(0, 8000)]
  );

  await client.end();
  console.log('Watchdog execution complete.');
}

// Run for a sample URL
runWatchdog('https://brevo.com').catch(err => console.error('Watchdog run failed:', err));