#!/usr/bin/env node

/**
 * Plugin CLI Tool
 *
 * Usage:
 *   plugin-cli build              Build the plugin
 *   plugin-cli publish            Publish to marketplace
 *   plugin-cli init               Initialize a new plugin project
 */

import { execSync } from 'child_process';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join, resolve } from 'path';
import { createReadStream } from 'fs';
import { FormData } from 'undici';

const API_URL = process.env.PLUGIN_API_URL || 'http://localhost:3000';

interface PackageJson {
  name: string;
  version: string;
  description?: string;
  pluginManifest?: {
    id: string;
    name: string;
    version: string;
    description?: string;
    category?: string;
    contributes?: object;
  };
}

interface PluginManifest {
  id: string;
  name: string;
  version: string;
  description?: string;
  category?: string;
  contributes?: object;
}

function readPackageJson(dir: string): PackageJson {
  const pkgPath = join(dir, 'package.json');
  if (!existsSync(pkgPath)) {
    throw new Error(`No package.json found in ${dir}`);
  }
  return JSON.parse(readFileSync(pkgPath, 'utf-8'));
}

function getManifest(pkg: PackageJson): PluginManifest {
  if (pkg.pluginManifest) {
    return pkg.pluginManifest;
  }

  // Try to read from dist/index.js or src/index.tsx
  throw new Error('No pluginManifest found in package.json');
}

async function build(dir: string): Promise<void> {
  console.log('Building plugin...');

  // Install dependencies if needed
  if (!existsSync(join(dir, 'node_modules'))) {
    console.log('Installing dependencies...');
    execSync('npm install', { cwd: dir, stdio: 'inherit' });
  }

  // Run build
  execSync('npm run build', { cwd: dir, stdio: 'inherit' });

  console.log('Build complete!');
}

async function publish(dir: string, sessionCookie?: string): Promise<void> {
  console.log('Publishing plugin...');

  const pkg = readPackageJson(dir);
  const manifest = getManifest(pkg);
  const distDir = join(dir, 'dist');

  // Check if built
  const bundlePath = join(distDir, 'index.js');
  if (!existsSync(bundlePath)) {
    console.log('Plugin not built. Building now...');
    await build(dir);
  }

  if (!existsSync(bundlePath)) {
    throw new Error('Bundle not found after build. Check your vite.config.ts');
  }

  // Check for source map
  const sourcemapPath = join(distDir, 'index.js.map');
  const hasSourcemap = existsSync(sourcemapPath);

  console.log(`Publishing ${manifest.name} v${manifest.version}...`);

  // First, check if plugin exists, if not create it
  const checkRes = await fetch(`${API_URL}/api/v1/developer/plugins`, {
    headers: sessionCookie ? { Cookie: sessionCookie } : {},
  });

  if (!checkRes.ok) {
    throw new Error('Failed to check existing plugins. Are you logged in?');
  }

  const { plugins } = (await checkRes.json()) as { plugins: { id: string }[] };
  const pluginExists = plugins.some((p) => p.id === manifest.id);

  if (!pluginExists) {
    console.log('Creating plugin entry...');
    const createRes = await fetch(`${API_URL}/api/v1/developer/plugins`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(sessionCookie ? { Cookie: sessionCookie } : {}),
      },
      body: JSON.stringify({
        id: manifest.id,
        name: manifest.name,
        description: manifest.description || pkg.description,
        category: manifest.category || 'other',
      }),
    });

    if (!createRes.ok) {
      const error = await createRes.json();
      throw new Error(`Failed to create plugin: ${JSON.stringify(error)}`);
    }
  }

  // Publish version with bundle
  const formData = new FormData();
  formData.append('version', manifest.version);
  formData.append('manifest', JSON.stringify(manifest));
  formData.append('bundle', new Blob([readFileSync(bundlePath)]), 'bundle.js');

  if (hasSourcemap) {
    formData.append('sourcemap', new Blob([readFileSync(sourcemapPath)]), 'bundle.js.map');
  }

  const publishRes = await fetch(`${API_URL}/api/v1/developer/plugins/${manifest.id}/versions`, {
    method: 'POST',
    headers: sessionCookie ? { Cookie: sessionCookie } : {},
    body: formData,
  });

  if (!publishRes.ok) {
    const error = await publishRes.json();
    throw new Error(`Failed to publish: ${JSON.stringify(error)}`);
  }

  const result = await publishRes.json();
  console.log('Published successfully!');
  console.log(`  Plugin: ${manifest.id}`);
  console.log(`  Version: ${manifest.version}`);
  console.log(`  Bundle URL: ${result.bundleUrl}`);
}

async function init(dir: string, pluginId: string): Promise<void> {
  console.log(`Initializing plugin: ${pluginId}`);

  const pluginDir = join(dir, pluginId);

  if (existsSync(pluginDir)) {
    throw new Error(`Directory ${pluginId} already exists`);
  }

  // Create directory structure
  execSync(`mkdir -p ${pluginDir}/src`);

  // Create package.json
  const pkg = {
    name: `@plugins/${pluginId}`,
    version: '1.0.0',
    description: `A plugin for the Pluggable Text Editor`,
    type: 'module',
    main: 'dist/index.js',
    types: 'dist/index.d.ts',
    scripts: {
      dev: 'vite build --watch',
      build: 'vite build',
      'type-check': 'tsc --noEmit',
    },
    peerDependencies: {
      react: '^19.0.0',
    },
    devDependencies: {
      '@types/react': '^19.0.2',
      '@vitejs/plugin-react': '^4.3.4',
      typescript: '^5.6.2',
      vite: '^6.0.5',
      'vite-plugin-dts': '^4.5.0',
    },
    pluginManifest: {
      id: pluginId,
      name: pluginId.split('-').map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' '),
      version: '1.0.0',
      description: 'A plugin for the Pluggable Text Editor',
      category: 'other',
      contributes: {
        slots: [{ slot: 'toolbar', component: 'MyComponent', order: 50 }],
      },
    },
  };

  writeFileSync(join(pluginDir, 'package.json'), JSON.stringify(pkg, null, 2));

  // Create tsconfig.json
  const tsconfig = {
    compilerOptions: {
      target: 'ES2020',
      useDefineForClassFields: true,
      lib: ['ES2020', 'DOM', 'DOM.Iterable'],
      module: 'ESNext',
      skipLibCheck: true,
      moduleResolution: 'bundler',
      allowImportingTsExtensions: true,
      isolatedModules: true,
      moduleDetection: 'force',
      noEmit: true,
      jsx: 'react-jsx',
      strict: true,
      noUnusedLocals: true,
      noUnusedParameters: true,
      declaration: true,
      declarationDir: './dist',
    },
    include: ['src'],
  };

  writeFileSync(join(pluginDir, 'tsconfig.json'), JSON.stringify(tsconfig, null, 2));

  // Create vite.config.ts
  const viteConfig = `import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import dts from 'vite-plugin-dts';
import { resolve } from 'path';

export default defineConfig({
  plugins: [
    react(),
    dts({ include: ['src'] }),
  ],
  build: {
    lib: {
      entry: resolve(__dirname, 'src/index.tsx'),
      name: '${pluginId.split('-').map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join('')}Plugin',
      fileName: 'index',
      formats: ['es'],
    },
    rollupOptions: {
      external: ['react', 'react-dom'],
      output: {
        globals: {
          react: 'React',
          'react-dom': 'ReactDOM',
        },
      },
    },
    outDir: 'dist',
    sourcemap: true,
  },
});
`;

  writeFileSync(join(pluginDir, 'vite.config.ts'), viteConfig);

  // Create src/index.tsx
  const componentName = pluginId.split('-').map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join('');
  const indexTsx = `import React from 'react';
import {
  definePlugin,
  type PluginProps,
  type PluginManifest,
  type PluginContext,
} from '@plugin-platform/sdk';

// ============================================================================
// Manifest
// ============================================================================

export const manifest: PluginManifest = {
  id: '${pluginId}',
  name: '${componentName}',
  version: '1.0.0',
  description: 'A plugin for the Pluggable Text Editor',
  category: 'other',
  contributes: {
    slots: [
      { slot: 'toolbar', component: '${componentName}', order: 50 },
    ],
  },
};

// ============================================================================
// Component
// ============================================================================

export function ${componentName}({ context }: PluginProps): React.ReactElement {
  return (
    <div className="px-3 py-1.5 text-sm text-gray-700 dark:text-gray-300">
      Hello from ${componentName}!
    </div>
  );
}

// ============================================================================
// Plugin Lifecycle
// ============================================================================

export function activate(context: PluginContext): void {
  console.log('[${pluginId}] Plugin activated');
}

// ============================================================================
// Export Plugin Module
// ============================================================================

export default definePlugin({
  manifest,
  activate,
  ${componentName},
});
`;

  writeFileSync(join(pluginDir, 'src', 'index.tsx'), indexTsx);

  // Create README.md
  const readme = `# ${componentName} Plugin

A plugin for the Pluggable Text Editor.

## Installation

\`\`\`bash
npm install
npm run build
\`\`\`

## Development

\`\`\`bash
npm run dev
\`\`\`

## Publishing

\`\`\`bash
npx plugin-cli publish
\`\`\`
`;

  writeFileSync(join(pluginDir, 'README.md'), readme);

  console.log(`Plugin initialized at ${pluginDir}`);
  console.log('');
  console.log('Next steps:');
  console.log(`  cd ${pluginId}`);
  console.log('  npm install');
  console.log('  npm run build');
}

// Main
const args = process.argv.slice(2);
const command = args[0];
const cwd = process.cwd();

switch (command) {
  case 'build':
    build(cwd).catch(console.error);
    break;
  case 'publish':
    publish(cwd, process.env.SESSION_COOKIE).catch(console.error);
    break;
  case 'init':
    if (!args[1]) {
      console.error('Usage: plugin-cli init <plugin-id>');
      process.exit(1);
    }
    init(cwd, args[1]).catch(console.error);
    break;
  default:
    console.log('Plugin CLI Tool');
    console.log('');
    console.log('Commands:');
    console.log('  build              Build the plugin');
    console.log('  publish            Publish to marketplace');
    console.log('  init <plugin-id>   Initialize a new plugin project');
    console.log('');
    console.log('Environment:');
    console.log('  PLUGIN_API_URL     API URL (default: http://localhost:3000)');
    console.log('  SESSION_COOKIE     Session cookie for authentication');
}
