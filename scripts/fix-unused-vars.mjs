#!/usr/bin/env node

/**
 * Enhanced script to fix unused variable errors by prefixing them with _
 * Now handles multi-line imports and more patterns
 */

import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.dirname(__dirname);

// Get all backend directories
const entries = fs.readdirSync(ROOT_DIR, { withFileTypes: true });
let totalFixed = 0;

for (const entry of entries) {
  if (!entry.isDirectory() || entry.name.startsWith('.') || entry.name === 'node_modules' || entry.name === 'scripts') {
    continue;
  }

  const backendPath = path.join(ROOT_DIR, entry.name, 'backend');
  const packageJsonPath = path.join(backendPath, 'package.json');

  if (!fs.existsSync(packageJsonPath)) {
    continue;
  }

  // Run ESLint and capture output
  let eslintOutput;
  try {
    eslintOutput = execSync('npm run lint 2>&1', { cwd: backendPath, encoding: 'utf8' });
  } catch (e) {
    eslintOutput = e.stdout || '';
  }

  // Parse ESLint output for unused variable errors
  const lines = eslintOutput.split('\n');
  const fixes = [];
  let currentFile = null;

  for (const line of lines) {
    // Match file path
    if (line.startsWith('/') && (line.endsWith('.ts') || line.endsWith('.js'))) {
      currentFile = line.trim();
      continue;
    }

    // Match pattern like: "23:3  error  'clickMetrics' is defined but never used."
    const match = line.match(/^\s*(\d+):(\d+)\s+error\s+'([^']+)'\s+is\s+(defined|assigned|never)/);
    if (match && currentFile) {
      const lineNum = parseInt(match[1], 10);
      const colNum = parseInt(match[2], 10);
      const varName = match[3];

      fixes.push({
        file: currentFile,
        line: lineNum,
        col: colNum,
        varName,
      });
    }
  }

  // Apply fixes - using direct replacement at reported position
  for (const fix of fixes) {
    if (!fs.existsSync(fix.file)) continue;
    if (fix.varName.startsWith('_')) continue;

    let content = fs.readFileSync(fix.file, 'utf8');
    const fileLines = content.split('\n');
    const lineIndex = fix.line - 1;

    if (lineIndex < 0 || lineIndex >= fileLines.length) continue;

    const originalLine = fileLines[lineIndex];
    const colIndex = fix.col - 1;

    // Check if the variable appears at the reported column
    if (colIndex < 0 || colIndex >= originalLine.length) continue;

    const charAtCol = originalLine.substring(colIndex);
    if (!charAtCol.startsWith(fix.varName)) continue;

    // Determine the context to apply the right fix
    const before = originalLine.substring(0, colIndex);
    const after = originalLine.substring(colIndex + fix.varName.length);

    let newLine = originalLine;
    let fixed = false;

    // Check if this is inside an import statement (multi-line)
    // Look back to find import keyword
    let inImport = before.includes('import') || (lineIndex > 0 && fileLines.slice(Math.max(0, lineIndex - 5), lineIndex).some(l => l.includes('import') && !l.includes('from')));

    // For imports, use "as _varName" syntax
    if (inImport && !after.includes('as ')) {
      newLine = before + fix.varName + ' as _' + fix.varName + after;
      fixed = newLine !== originalLine;
    }

    // For destructuring patterns, use "varName: _varName" syntax
    if (!fixed && before.includes('{') && after.match(/^\s*[,}]/)) {
      newLine = before + fix.varName + ': _' + fix.varName + after;
      fixed = newLine !== originalLine;
    }

    // For function parameters, just prefix with _
    if (!fixed && (before.match(/[(,]\s*$/) || before.match(/^\s*$/))) {
      newLine = before + '_' + fix.varName + after;
      fixed = newLine !== originalLine;
    }

    // For const/let/var declarations
    if (!fixed && before.match(/(const|let|var)\s+$/)) {
      newLine = before + '_' + fix.varName + after;
      fixed = newLine !== originalLine;
    }

    // Generic fallback: if in object context, use rename; otherwise prefix
    if (!fixed) {
      // For array destructuring elements
      if (before.match(/\[\s*$/) || before.match(/,\s*$/)) {
        newLine = before + '_' + fix.varName + after;
        fixed = newLine !== originalLine;
      }
    }

    // Final fallback: just try adding "as _" for imports
    if (!fixed && inImport) {
      newLine = before + fix.varName + ' as _' + fix.varName + after;
      fixed = newLine !== originalLine;
    }

    if (fixed && newLine !== originalLine) {
      fileLines[lineIndex] = newLine;
      fs.writeFileSync(fix.file, fileLines.join('\n'), 'utf8');
      console.log(`Fixed: ${fix.file}:${fix.line} - ${fix.varName} -> _${fix.varName}`);
      totalFixed++;
    }
  }
}

console.log(`\nTotal fixes applied: ${totalFixed}`);
