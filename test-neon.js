// test-neon.js
// Run with: node test-neon.js
// Loads credentials from a local .env file — see .env.example for the format.

import 'dotenv/config';
import pg from 'pg';
const { Client } = pg;

const DATABASE_URL = process.env.DATABASE_URL;

async function testNeon() {
  if (!DATABASE_URL) {
    console.error('❌ Missing DATABASE_URL.');
    console.error('   Make sure a .env file exists in this folder with it set (see .env.example).');
    return;
  }

  const client = new Client({ connectionString: DATABASE_URL });
  await client.connect();
  console.log('✅ Connected to Neon.');

  // Upsert a test row — same pattern the real pipeline will use.
  const testUrl = 'https://test-example.com';
  const testContent = 'This is a test snapshot from test-neon.js';

  await client.query(
    `insert into competitor_snapshots (url, last_content, updated_at)
     values ($1, $2, now())
     on conflict (url) do update set last_content = excluded.last_content, updated_at = now()`,
    [testUrl, testContent]
  );
  console.log('✅ Upsert succeeded.');

  // Read it back
  const result = await client.query(
    `select * from competitor_snapshots where url = $1`,
    [testUrl]
  );
  console.log('✅ Read back:', result.rows[0]);

  await client.end();
  console.log('✅ All good — connection, table, upsert, and read all work.');
}

testNeon().catch(err => {
  console.error('❌ Neon test failed:', err.message);
});