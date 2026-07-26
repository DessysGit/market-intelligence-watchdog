# Market Intelligence Watchdog — Prompt Library

## Status (updated after direction-detection testing)
- ✅ LLM correctly DETECTS that content changed, even for a single small change
  buried in ~9,700 chars of otherwise identical text.
- ❌ LLM reliably gets the DIRECTION backwards — reports increases as decreases,
  additions as removals. Reproduced 3 times in a row (fresh comparison, prompt
  emphasizing "no changes" case, and a version with explicit "PREVIOUS=older/
  CURRENT=newer" instructions repeated twice). Not a prompt-wording issue —
  looks like a genuine reasoning limitation of Gemini 1.5 Flash on this task.
- ✅ **Pivoted approach**: stopped asking the LLM to compare two snapshots at
  all. A code-level diff (`diff` npm package, `diffLines`) now computes
  added/removed lines deterministically, and the LLM's only job is to explain
  an already-directional, pre-labeled list. See `computeDiff()` in index.js.

## Why the pivot, not just more prompt tuning
The whole point of this tool is telling a business owner what a competitor
DID — a price increase reported as a decrease is actively misleading, worse
than no alert at all. After 3 failed attempts at fixing this purely through
prompt wording, doing the comparison in code removes the ambiguity entirely:
the LLM never sees two blocks it could confuse the order of, only a single
pre-sorted "added" list and "removed" list.

## Current prompt (used only to explain a pre-computed diff)

```
You are summarizing pre-computed changes to a competitor's webpage for a business owner.
These lists were computed by a diff tool, not by you — the direction is already correct.
Do not re-derive or second-guess which item is older or newer; just explain what they mean.

LINES ADDED (new in the latest version — did not exist before):
{added.join('\n---\n') || '(none)'}

LINES REMOVED (existed before, no longer present):
{removed.join('\n---\n') || '(none)'}

Give a 3-bullet executive summary of what these additions/removals mean for the business.
Focus on pricing, features, stats, and campaigns. For each bullet, state explicitly whether
the item was ADDED or REMOVED, using those exact words. Ignore anything that looks like
navigation menu text, cookie-banner text, or footer links — focus only on substantive content.
```

If both `added` and `removed` are empty, the code short-circuits to
"No major changes detected." without calling Gemini at all — saves an API
call on days with zero change, and removes any chance of the model
manufacturing a false "no changes" or false diff on identical input.

## Retired approach (kept for reference — do not revert to this)
Earlier version asked Gemini to compare two full snapshots itself with a
"STEP 1 — comparison, STEP 2 — summary" structure and explicit older/newer
labels. This correctly handled the identical-input case ("No major changes
detected") but failed 3/3 times on direction when a real (even tiny) change
was present. Retained in git history / earlier chat log if useful context,
but the diff-based approach above should be the baseline going forward.

## Known limitations / things to watch
- `diffLines` operates on whole lines. A change that's a single word inside
  a long paragraph will surface the ENTIRE line as both removed (old version)
  and added (new version) — not just the word. This is fine for the LLM
  summary step (it can still describe the substance), but means the
  added/removed lists may look more verbose than the actual change. Worth
  keeping an eye on with real competitor sites — if paragraphs are long,
  consider `diffWords` instead of `diffLines` for more surgical diffs.
- Content fed into the diff should still go through `cleanContent()` first —
  diffing raw Jina output (with all its nav/link noise) would produce a lot
  of meaningless added/removed lines from cookie-banner boilerplate shifting
  around, not just real content changes.
- Not yet tested: a real competitor site with genuinely dynamic/rotating
  content (e.g. a "featured products" carousel that reshuffles order without
  real changes) — that could produce noisy false-positive diffs. Worth
  checking once a real target URL (not just Brevo) is chosen.