#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

// Read the prompt.txt file
const promptPath = path.join(__dirname, 'assets', 'prompt.txt');
const promptContent = fs.readFileSync(promptPath, 'utf8');

// Escape backticks and backslashes for template literal
const escapedPrompt = promptContent.replace(/\\/g, '\\\\').replace(/`/g, '\\`').replace(/\$/g, '\\$');

// Update ui.html
const uiHtmlPath = path.join(__dirname, 'ui.html');
let uiHtml = fs.readFileSync(uiHtmlPath, 'utf8');

// Replace the PROMPT_TEXT constant in ui.html
const uiRegex = /const PROMPT_TEXT = `[\s\S]*?`;/;
uiHtml = uiHtml.replace(uiRegex, `const PROMPT_TEXT = \`${escapedPrompt}\`;`);

fs.writeFileSync(uiHtmlPath, uiHtml);
console.log('✓ Updated ui.html with latest prompt');

// Update code.ts
const codeTypescriptPath = path.join(__dirname, 'code.ts');
let codeTypescript = fs.readFileSync(codeTypescriptPath, 'utf8');

// Replace the PROMPT_TEXT constant in code.ts
const tsRegex = /const PROMPT_TEXT = `[\s\S]*?`;/;
codeTypescript = codeTypescript.replace(tsRegex, `const PROMPT_TEXT = \`${escapedPrompt}\`;`);

fs.writeFileSync(codeTypescriptPath, codeTypescript);
console.log('✓ Updated code.ts with latest prompt');

console.log('\nPrompt updated successfully! Run "npm run build" or "npx tsc" to compile.');
