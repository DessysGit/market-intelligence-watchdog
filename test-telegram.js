// test-telegram.js
// Run with: node test-telegram.js
// Loads credentials from a local .env file — see .env.example for the format.

import 'dotenv/config';

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;

async function sendTestAlert() {
  if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) {
    console.error('❌ Missing TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID.');
    console.error('   Make sure a .env file exists in this folder with both set (see .env.example).');
    return;
  }

  const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;

  console.log('DEBUG — token length:', TELEGRAM_BOT_TOKEN.length);
  console.log('DEBUG — token (masked):', TELEGRAM_BOT_TOKEN.slice(0, 6) + '...' + TELEGRAM_BOT_TOKEN.slice(-6));
  console.log('DEBUG — chat_id:', TELEGRAM_CHAT_ID);
  console.log('DEBUG — full URL (masked):', url.replace(TELEGRAM_BOT_TOKEN, TELEGRAM_BOT_TOKEN.slice(0,6) + '...MASKED'));

  const message = `🚨 <b>Market Watchdog Alert</b>\n\n<b>Target:</b> https://brevo.com\n\n<b>Insights:</b>\n- Test message: pipeline wiring works.\n- If you see this in Telegram, the bot + chat_id are correctly configured.`;

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: TELEGRAM_CHAT_ID,
      text: message,
      parse_mode: 'HTML'
    })
  });

  const data = await response.json();

  if (data.ok) {
    console.log('✅ Message sent successfully! Check your Telegram.');
  } else {
    console.error('❌ Telegram API returned an error:');
    console.error(JSON.stringify(data, null, 2));
  }
}

sendTestAlert().catch(err => console.error('Request failed:', err));