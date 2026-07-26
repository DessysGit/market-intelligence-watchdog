const fs = require('fs');

const targetUrl = process.argv[2] || 'https://example.com';

async function testJina(url) {
  const jinaUrl = `https://r.jina.ai/${url}`;
  console.log(`Fetching: ${jinaUrl}\n`);

  const start = Date.now();
  const response = await fetch(jinaUrl);
  const elapsed = Date.now() - start;

  console.log(`Status: ${response.status}`);
  console.log(`Time: ${elapsed}ms\n`);

  const text = await response.text();
  console.log(`Content length: ${text.length} chars\n`);

  fs.writeFileSync('raw-output.txt', text, 'utf-8');
  console.log('Full output saved to raw-output.txt\n');

  console.log('--- First 1000 chars ---');
  console.log(text.slice(0, 1000));
}

testJina(targetUrl).catch(err => console.error('Error:', err));