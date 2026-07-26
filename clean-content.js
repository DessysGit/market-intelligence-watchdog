// clean-content.js
const fs = require('fs');

function cleanJinaContent(text) {
  return text
    // Strip markdown images: ![alt](url)
    .replace(/!\[.*?\]\(.*?\)/g, '')
    // Strip markdown links but keep the link text: [text](url) -> text
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    // Collapse repeated blank lines
    .replace(/\n{3,}/g, '\n\n')
    // Strip lines that are just bullets/asterisks with nothing else
    .replace(/^\*\s*$/gm, '')
    .trim();
}

// Usage: node clean-content.js raw-output.txt
const raw = fs.readFileSync(process.argv[2], 'utf-8');
const cleaned = cleanJinaContent(raw);
console.log(`Original: ${raw.length} chars → Cleaned: ${cleaned.length} chars\n`);
console.log(cleaned.slice(0, 3000));