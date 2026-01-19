#!/usr/bin/env node

/**
 * Script to fix unused variable errors by prefixing them with _
 * This script parses ESLint output and applies fixes
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

  for (const line of lines) {
    // Match pattern like: "23:3  error  'clickMetrics' is defined but never used."
    const match = line.match(/^\s*(\d+):(\d+)\s+error\s+'([^']+)'\s+is\s+(defined|assigned)/);
    if (match) {
      const lineNum = parseInt(match[1], 10);
      const colNum = parseInt(match[2], 10);
      const varName = match[3];

      // Find the file path (it appears on a line before the errors)
      for (let i = lines.indexOf(line) - 1; i >= 0; i--) {
        if (lines[i].startsWith('/') && lines[i].endsWith('.ts')) {
          fixes.push({
            file: lines[i].trim(),
            line: lineNum,
            col: colNum,
            varName,
          });
          break;
        }
      }
    }
  }

  // Apply fixes
  for (const fix of fixes) {
    if (!fs.existsSync(fix.file)) continue;

    const content = fs.readFileSync(fix.file, 'utf8');
    const fileLines = content.split('\n');
    const lineIndex = fix.line - 1;

    if (lineIndex >= 0 && lineIndex < fileLines.length) {
      const originalLine = fileLines[lineIndex];

      // Skip if already prefixed with _
      if (fix.varName.startsWith('_')) continue;

      // Replace the variable name with _prefixed version
      // Handle different patterns: imports, catch blocks, destructuring, regular declarations
      const patterns = [
        // Import pattern: import { foo } or import { foo as bar }
        new RegExp(`\\b${fix.varName}\\b(?=\\s*[,}]|\\s+as\\s+|\\s+from\\s+)`),
        // Catch pattern: } catch (error) {
        new RegExp(`catch\\s*\\(\\s*${fix.varName}\\s*\\)`),
        // Destructuring: const { foo } = or const { foo, bar } =
        new RegExp(`\\{[^}]*\\b${fix.varName}\\b[^}]*\\}\\s*=`),
        // Regular declaration: const foo = or let foo =
        new RegExp(`(const|let|var)\\s+${fix.varName}\\b`),
        // Function parameter: (foo, bar) or (foo) or foo =>
        new RegExp(`[(,]\\s*${fix.varName}\\s*[),]`),
      ];

      let newLine = originalLine;
      let fixed = false;

      // Special handling for catch blocks
      if (originalLine.includes('catch') && originalLine.includes(fix.varName)) {
        newLine = originalLine.replace(
          new RegExp(`catch\\s*\\(\\s*${fix.varName}\\s*\\)`),
          `catch (_${fix.varName})`
        );
        fixed = newLine !== originalLine;
      }

      // Special handling for destructuring imports with 'as'
      if (!fixed && originalLine.includes('import')) {
        // Handle: import { foo, bar } from - replace just the variable name in context
        newLine = originalLine.replace(
          new RegExp(`(\\{[^}]*?)\\b${fix.varName}\\b([^}]*?\\})`),
          (match, before, after) => `${before}_${fix.varName}${after}`
        );
        fixed = newLine !== originalLine;
      }

      // Handle const/let/var declarations
      if (!fixed) {
        newLine = originalLine.replace(
          new RegExp(`(const|let|var)\\s+${fix.varName}\\b`),
          `$1 _${fix.varName}`
        );
        fixed = newLine !== originalLine;
      }

      // Handle destructuring assignments
      if (!fixed) {
        newLine = originalLine.replace(
          new RegExp(`(\\{[^}]*?)\\b${fix.varName}\\b([^}]*?\\}\\s*=)`),
          (match, before, after) => `${before}_${fix.varName}${after}`
        );
        fixed = newLine !== originalLine;
      }

      // Handle function parameters
      if (!fixed) {
        newLine = originalLine.replace(
          new RegExp(`([,(]\\s*)${fix.varName}(\\s*[,)])`),
          `$1_${fix.varName}$2`
        );
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
}

console.log(`\nTotal fixes applied: ${totalFixed}`);
