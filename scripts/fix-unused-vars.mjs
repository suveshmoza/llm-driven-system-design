#!/usr/bin/env node

/**
 * Enhanced script to fix unused variable errors by prefixing them with _
 * Handles imports with 'as' syntax, destructuring, catch blocks, type imports, and more
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

  // Apply fixes
  for (const fix of fixes) {
    if (!fs.existsSync(fix.file)) continue;

    // Skip if already prefixed with _
    if (fix.varName.startsWith('_')) continue;

    let content = fs.readFileSync(fix.file, 'utf8');
    const fileLines = content.split('\n');
    const lineIndex = fix.line - 1;

    if (lineIndex < 0 || lineIndex >= fileLines.length) continue;

    const originalLine = fileLines[lineIndex];
    let newLine = originalLine;
    let fixed = false;

    // Pattern 1: Catch blocks - catch (error)
    if (!fixed && originalLine.includes('catch')) {
      const catchPattern = new RegExp(`(catch\\s*\\()\\s*${fix.varName}\\s*(\\))`);
      if (catchPattern.test(originalLine)) {
        newLine = originalLine.replace(catchPattern, `$1_${fix.varName}$2`);
        fixed = newLine !== originalLine;
      }
    }

    // Pattern 2: Type imports - import type { Foo } or import { type Foo }
    if (!fixed && originalLine.includes('import')) {
      // Handle: import type { Foo, Bar }
      const typeImportPattern = new RegExp(`(import\\s+type\\s*\\{[^}]*?)\\b(${fix.varName})\\b([^}]*?\\})`);
      if (typeImportPattern.test(originalLine)) {
        newLine = originalLine.replace(typeImportPattern, `$1${fix.varName} as _${fix.varName}$3`);
        fixed = newLine !== originalLine;
      }

      // Handle: import { type Foo, bar }
      if (!fixed) {
        const inlineTypePattern = new RegExp(`(\\{[^}]*?)(type\\s+${fix.varName})\\b([^}]*?\\})`);
        if (inlineTypePattern.test(originalLine)) {
          newLine = originalLine.replace(inlineTypePattern, `$1type ${fix.varName} as _${fix.varName}$3`);
          fixed = newLine !== originalLine;
        }
      }
    }

    // Pattern 3: Import with 'as' - import { foo as bar }
    if (!fixed && originalLine.includes('import') && originalLine.includes('as')) {
      const asPattern = new RegExp(`\\b(${fix.varName})\\s+as\\s+(${fix.varName})\\b`);
      if (asPattern.test(originalLine)) {
        newLine = originalLine.replace(asPattern, `$1 as _${fix.varName}`);
        fixed = newLine !== originalLine;
      } else {
        const importPattern = new RegExp(`(import\\s*\\{[^}]*?)\\b(${fix.varName})\\b([^}]*?\\}\\s*from)`);
        if (importPattern.test(originalLine)) {
          const hasAs = new RegExp(`${fix.varName}\\s+as\\s+`).test(originalLine);
          if (!hasAs) {
            newLine = originalLine.replace(importPattern, `$1${fix.varName} as _${fix.varName}$3`);
            fixed = newLine !== originalLine;
          }
        }
      }
    }

    // Pattern 4: Simple import - import { foo } or import { foo, bar }
    if (!fixed && originalLine.includes('import') && !originalLine.includes('as')) {
      const importPattern = new RegExp(`(import\\s*\\{[^}]*?)\\b(${fix.varName})\\b([^}]*?\\}\\s*from)`);
      if (importPattern.test(originalLine)) {
        newLine = originalLine.replace(importPattern, `$1${fix.varName} as _${fix.varName}$3`);
        fixed = newLine !== originalLine;
      }
    }

    // Pattern 5: const/let/var declarations
    if (!fixed) {
      const declPattern = new RegExp(`(const|let|var)\\s+${fix.varName}\\b`);
      if (declPattern.test(originalLine)) {
        newLine = originalLine.replace(declPattern, `$1 _${fix.varName}`);
        fixed = newLine !== originalLine;
      }
    }

    // Pattern 6: Destructuring - const { foo, bar } =
    if (!fixed) {
      const destructPattern = new RegExp(`(\\{[^}]*?)\\b(${fix.varName})\\b([^}]*?\\}\\s*=)`);
      if (destructPattern.test(originalLine)) {
        newLine = originalLine.replace(destructPattern, `$1${fix.varName}: _${fix.varName}$3`);
        fixed = newLine !== originalLine;
      }
    }

    // Pattern 7: Function parameters - (foo, bar) or function(foo)
    if (!fixed) {
      const paramPattern = new RegExp(`([\\(,]\\s*)${fix.varName}(\\s*[\\),:])`);
      if (paramPattern.test(originalLine)) {
        newLine = originalLine.replace(paramPattern, `$1_${fix.varName}$2`);
        fixed = newLine !== originalLine;
      }
    }

    // Pattern 8: Arrow function single param - foo =>
    if (!fixed) {
      const arrowPattern = new RegExp(`^(\\s*)${fix.varName}(\\s*=>)`);
      if (arrowPattern.test(originalLine)) {
        newLine = originalLine.replace(arrowPattern, `$1_${fix.varName}$2`);
        fixed = newLine !== originalLine;
      }
    }

    // Pattern 9: Standalone type import on same line - handles column-based detection
    if (!fixed && fix.col > 1) {
      // Check if the variable name appears near the column position
      const colIndex = fix.col - 1;
      if (originalLine.substring(colIndex).startsWith(fix.varName)) {
        // Try various patterns based on context
        const beforeVar = originalLine.substring(0, colIndex);
        const afterVar = originalLine.substring(colIndex + fix.varName.length);

        // If it's in an import context
        if (beforeVar.includes('import') || beforeVar.includes('{')) {
          newLine = beforeVar + fix.varName + ' as _' + fix.varName + afterVar;
          fixed = newLine !== originalLine;
        }
      }
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
