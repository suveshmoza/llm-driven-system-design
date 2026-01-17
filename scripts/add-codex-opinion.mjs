#!/usr/bin/env node

/**
 * Adds Codex opinion sections to each project's claude.md file
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');

// Read the codex-opinion.md file
const codexOpinionPath = path.join(repoRoot, 'codex-opinion.md');
const codexContent = fs.readFileSync(codexOpinionPath, 'utf8');

// Parse the file into sections by project
const sections = codexContent.split(/^## /m).slice(1); // Skip the header

let updated = 0;
let skipped = 0;

for (const section of sections) {
  const lines = section.trim().split('\n');
  const projectName = lines[0].trim();
  const content = lines.slice(1).join('\n').trim();

  const claudeMdPath = path.join(repoRoot, projectName, 'claude.md');

  if (!fs.existsSync(claudeMdPath)) {
    console.log(`Skipping ${projectName}: claude.md not found`);
    skipped++;
    continue;
  }

  let claudeContent = fs.readFileSync(claudeMdPath, 'utf8');

  // Check if already has Codex Opinion section
  if (claudeContent.includes('## Codex Opinion')) {
    console.log(`Skipping ${projectName}: already has Codex Opinion`);
    skipped++;
    continue;
  }

  // Add the Codex Opinion section at the end
  const opinionSection = `\n## Codex Opinion\n\n${content}\n`;
  claudeContent = claudeContent.trimEnd() + '\n' + opinionSection;

  fs.writeFileSync(claudeMdPath, claudeContent);
  console.log(`Updated ${projectName}`);
  updated++;
}

console.log(`\nDone: ${updated} updated, ${skipped} skipped`);
