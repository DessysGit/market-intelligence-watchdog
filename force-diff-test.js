// force-diff-test.js
// ONE-TIME USE: artificially alters the stored Neon snapshot for a target URL
// so the NEXT scheduled/manual run of index.js will detect a "change" and
// exercise the full alert path against the real target — without waiting
// for IC Wealth to actually update their site.
//
// Run with: node force-diff-test.js
// After running, trigger the workflow manually (or run `node index.js`
// locally) to see the forced diff flow through to Telegram.

import 'dotenv/config';
import pg from 'pg';
const { Client } = pg;

const DATABASE_URL = process.env.DATABASE_URL;
const TARGET_URL = 'https://wealth.ic.africa/fixed-income';

async function forceDiff() {
  if (!DATABASE_URL) {
    console.error('❌ Missing DATABASE_URL. Check your .env file.');
    return;
  }

  const client = new Client({ connectionString: DATABASE_URL });
  await client.connect();

  const result = await client.query(
    `select last_content from competitor_snapshots where url = $1`,
    [TARGET_URL]
  );

  if (!result.rows[0]) {
    console.error(`❌ No stored snapshot found for ${TARGET_URL} — run the real pipeline at least once first.`);
    await client.end();
    return;
  }

  const original = result.rows[0].last_content;

  // Inject one obviously fake, easy-to-spot line so the diff has something
  // real to report — mimics a plausible "new product/rate" announcement.
  const altered = original + '\n\nTEST INJECTION: New 9-month Treasury Note now available at 28% annual yield — limited time offer.';

  await client.query(
    `update competitor_snapshots set last_content = $1, updated_at = now() where url = $2`,
    [altered, TARGET_URL]
  );

  console.log('✅ Stored snapshot altered with a fake test line.');
  console.log('   Next run of index.js will compare live content against this altered');
  console.log('   version, detect the "removed" fake line, and should trigger a real alert.');
  console.log('   Run `node index.js` now, or trigger the GitHub Actions workflow manually.');

  await client.end();
}

forceDiff().catch(err => console.error('❌ Force-diff test failed:', err.message));