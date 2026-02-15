#!/usr/bin/env node
/**
 * Project health-check / triage script.
 * Systematically tests every project and produces a status report.
 *
 * Usage:
 *   node scripts/triage-projects.mjs --all              # Triage all projects
 *   node scripts/triage-projects.mjs instagram twitter   # Triage specific projects
 *   node scripts/triage-projects.mjs --wave 1            # Triage Wave 1 projects
 *   node scripts/triage-projects.mjs --list              # List available projects
 *   node scripts/triage-projects.mjs --report            # Show last triage report
 *
 * Per-project workflow:
 *   1. Stop Docker containers (clean slate)
 *   2. Start Docker services (PostgreSQL, Redis, etc.)
 *   3. Wait for PostgreSQL (pg_isready) and Redis (redis-cli ping)
 *   4. Run DB migration (npm run db:migrate if available)
 *   5. Run seed SQL (backend/db-seed/seed.sql if exists)
 *   6. Start backend, wait for port 3000
 *   7. Start frontend, wait for port 5173
 *   8. Health checks:
 *      - Frontend loads (HTTP 200 on localhost:5173)
 *      - Login works (POST credentials, verify response)
 *      - Main page renders content (fetch HTML, check for key content)
 *   9. Output JSON status
 *  10. Cleanup everything
 *
 * Output:
 *   - triage-report.json at repo root
 *   - Console summary: GREEN / YELLOW / ORANGE / RED
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { spawn, execSync } from 'child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');
const configDir = path.join(__dirname, 'screenshot-configs');
const reportPath = path.join(repoRoot, 'triage-report.json');

// CLI argument parsing
const args = process.argv.slice(2);
const isAll = args.includes('--all');
const isList = args.includes('--list');
const isReport = args.includes('--report');
const waveIdx = args.indexOf('--wave');
const waveNum = waveIdx !== -1 ? parseInt(args[waveIdx + 1], 10) : null;
const projectArgs = args.filter(arg => !arg.startsWith('--') && (waveIdx === -1 || args.indexOf(arg) !== waveIdx + 1));

// Track spawned processes for cleanup
const spawnedProcesses = [];

// Waves as defined in the plan
const waves = {
  1: ['instagram', 'twitter', 'airbnb', 'bitly', 'slack', 'discord', 'reddit', 'shopify', 'uber', 'doordash'],
  2: ['spotify', 'netflix', 'notion', 'calendly', 'stripe', 'tiktok', 'yelp', 'youtube', 'whatsapp', 'venmo'],
  3: ['hotel-booking', 'jira', 'linkedin', 'etsy', 'imessage', 'google-calendar', 'google-docs', 'strava', 'job-scheduler', 'tinder'],
  4: ['amazon', 'dropbox', 'github', 'google-search', 'robinhood', 'apple-music', 'apple-pay', 'apple-tv', 'app-store', 'icloud'],
};

// Colors for console output
const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  cyan: '\x1b[36m',
  dim: '\x1b[2m',
  bold: '\x1b[1m',
  magenta: '\x1b[35m',
  bgGreen: '\x1b[42m\x1b[30m',
  bgYellow: '\x1b[43m\x1b[30m',
  bgRed: '\x1b[41m\x1b[37m',
  bgMagenta: '\x1b[45m\x1b[37m',
};

function log(message, color = 'reset') {
  console.log(`${colors[color]}${message}${colors.reset}`);
}

function logStep(step, message) {
  console.log(`${colors.cyan}[${step}]${colors.reset} ${message}`);
}

function logSuccess(message) {
  console.log(`${colors.green}  ✓${colors.reset} ${message}`);
}

function logWarning(message) {
  console.log(`${colors.yellow}  ⚠${colors.reset} ${message}`);
}

function logError(message) {
  console.log(`${colors.red}  ✗${colors.reset} ${message}`);
}

// ─────────────────────────────────────────────────────────────────────
// Config loading
// ─────────────────────────────────────────────────────────────────────

function loadConfigs() {
  if (!fs.existsSync(configDir)) {
    return [];
  }
  return fs.readdirSync(configDir)
    .filter(file => file.endsWith('.json'))
    .map(file => {
      const configPath = path.join(configDir, file);
      const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
      return { ...config, _file: file };
    });
}

/**
 * Discover projects that have both frontend/ and backend/ directories,
 * even if they don't have a screenshot config.
 */
function discoverProjects() {
  const entries = fs.readdirSync(repoRoot, { withFileTypes: true });
  const projects = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (entry.name.startsWith('.') || entry.name === 'node_modules' || entry.name === 'scripts') continue;

    const projectDir = path.join(repoRoot, entry.name);
    const hasFrontend = fs.existsSync(path.join(projectDir, 'frontend', 'package.json'));
    const hasBackend = fs.existsSync(path.join(projectDir, 'backend', 'package.json'));
    const hasDocker = fs.existsSync(path.join(projectDir, 'docker-compose.yml')) ||
                      fs.existsSync(path.join(projectDir, 'docker-compose.yaml'));

    if (hasFrontend && hasBackend) {
      projects.push({
        name: entry.name,
        hasFrontend,
        hasBackend,
        hasDocker,
        hasConfig: fs.existsSync(path.join(configDir, `${entry.name}.json`)),
      });
    }
  }

  return projects.sort((a, b) => a.name.localeCompare(b.name));
}

// ─────────────────────────────────────────────────────────────────────
// Infrastructure helpers (adapted from screenshots.mjs)
// ─────────────────────────────────────────────────────────────────────

async function isUrlReachable(url, timeout = 5000) {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);
    const response = await fetch(url, { method: 'GET', signal: controller.signal });
    clearTimeout(timeoutId);
    return { ok: response.ok, status: response.status };
  } catch {
    return { ok: false, status: 0 };
  }
}

async function waitForUrl(url, maxWait = 60000) {
  const startTime = Date.now();
  while (Date.now() - startTime < maxWait) {
    const result = await isUrlReachable(url);
    if (result.ok || result.status === 404) return true;
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  return false;
}

function hasDockerCompose(projectDir) {
  return fs.existsSync(path.join(projectDir, 'docker-compose.yml')) ||
         fs.existsSync(path.join(projectDir, 'docker-compose.yaml'));
}

function isDockerRunning() {
  try {
    execSync('docker info', { stdio: 'ignore', timeout: 10000 });
    return true;
  } catch {
    return false;
  }
}

function killProcessOnPort(port) {
  try {
    if (process.platform === 'darwin' || process.platform === 'linux') {
      const result = execSync(`lsof -ti:${port}`, { encoding: 'utf-8', stdio: 'pipe' }).trim();
      if (result) {
        result.split('\n').forEach(pid => {
          try { execSync(`kill -9 ${pid}`, { stdio: 'pipe' }); } catch {}
        });
      }
    }
  } catch {}
}

// ─────────────────────────────────────────────────────────────────────
// Docker management
// ─────────────────────────────────────────────────────────────────────

async function stopDockerCompose(projectDir, projectName) {
  if (!hasDockerCompose(projectDir) || !isDockerRunning()) return true;

  logStep('DOCKER', `Stopping infrastructure for ${projectName}...`);
  try {
    execSync('docker-compose down -v --remove-orphans', {
      cwd: projectDir, stdio: 'pipe', timeout: 60000,
    });
    logSuccess('Docker services stopped');
    await new Promise(resolve => setTimeout(resolve, 2000));
    return true;
  } catch (error) {
    try {
      execSync('docker-compose kill', { cwd: projectDir, stdio: 'pipe', timeout: 30000 });
      execSync('docker-compose down -v --remove-orphans', { cwd: projectDir, stdio: 'pipe', timeout: 30000 });
    } catch {}
    return true;
  }
}

async function startDockerCompose(projectDir, projectName) {
  if (!hasDockerCompose(projectDir)) return { started: false, error: 'No docker-compose.yml' };
  if (!isDockerRunning()) return { started: false, error: 'Docker not running' };

  logStep('DOCKER', `Starting infrastructure for ${projectName}...`);
  try {
    execSync('docker-compose up -d', { cwd: projectDir, stdio: 'pipe', timeout: 120000 });
    logSuccess('Docker services started');
    await new Promise(resolve => setTimeout(resolve, 5000));
    return { started: true };
  } catch (error) {
    logError(`Docker-compose failed: ${error.message}`);
    return { started: false, error: error.message };
  }
}

// ─────────────────────────────────────────────────────────────────────
// Database checks
// ─────────────────────────────────────────────────────────────────────

async function waitForPostgres(projectDir, config) {
  const dbUser = config.dbUser || config.name.replace(/-/g, '_');

  logStep('DATABASE', 'Waiting for PostgreSQL...');
  for (let i = 0; i < 20; i++) {
    try {
      execSync(`docker-compose exec -T postgres pg_isready -U ${dbUser}`, {
        cwd: projectDir, stdio: 'pipe', timeout: 5000,
      });
      logSuccess('PostgreSQL ready');
      return true;
    } catch {
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  }
  logError('PostgreSQL not ready after 20 seconds');
  return false;
}

async function waitForRedis(projectDir) {
  try {
    const services = execSync('docker-compose config --services', {
      cwd: projectDir, encoding: 'utf-8', stdio: 'pipe',
    });
    if (!services.includes('redis')) return true; // No Redis service
  } catch {
    return true;
  }

  logStep('REDIS', 'Waiting for Redis...');
  for (let i = 0; i < 15; i++) {
    try {
      execSync('docker-compose exec -T redis redis-cli ping', {
        cwd: projectDir, stdio: 'pipe', timeout: 5000,
      });
      logSuccess('Redis ready');
      return true;
    } catch {
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  }
  logError('Redis not ready after 15 seconds');
  return false;
}

// ─────────────────────────────────────────────────────────────────────
// Migration and seeding
// ─────────────────────────────────────────────────────────────────────

async function runMigration(projectDir, config) {
  const backendDir = path.join(projectDir, 'backend');
  const pkgJsonPath = path.join(backendDir, 'package.json');

  if (!fs.existsSync(pkgJsonPath)) return { ran: false, reason: 'No package.json' };

  const pkgJson = JSON.parse(fs.readFileSync(pkgJsonPath, 'utf-8'));
  if (!pkgJson.scripts?.['db:migrate']) return { ran: false, reason: 'No db:migrate script' };

  logStep('MIGRATE', 'Running database migrations...');
  try {
    execSync('npm run db:migrate', {
      cwd: backendDir, stdio: 'pipe', timeout: 30000,
    });
    logSuccess('Migrations complete');
    return { ran: true };
  } catch (error) {
    const stderr = error.stderr?.toString().slice(0, 500) || error.message;
    logError(`Migration failed: ${stderr}`);
    return { ran: false, error: stderr };
  }
}

async function runSeed(projectDir, config) {
  const dbName = config.dbName || config.name.replace(/-/g, '_');
  const dbUser = config.dbUser || config.name.replace(/-/g, '_');

  // Look for seed.sql in common locations
  const seedPaths = [
    path.join(projectDir, 'backend', 'db-seed', 'seed.sql'),
    path.join(projectDir, 'backend', 'seed.sql'),
    path.join(projectDir, 'backend', 'db', 'seed.sql'),
    path.join(projectDir, 'db', 'seed.sql'),
  ];

  const seedPath = seedPaths.find(p => fs.existsSync(p));
  if (!seedPath) return { ran: false, reason: 'No seed.sql found' };

  logStep('SEED', `Seeding database from ${path.relative(projectDir, seedPath)}...`);
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      execSync(`cat "${seedPath}" | docker-compose exec -T postgres psql -U ${dbUser} -d ${dbName}`, {
        cwd: projectDir, stdio: 'pipe', timeout: 30000, shell: true,
      });
      logSuccess('Database seeded');
      return { ran: true };
    } catch (error) {
      if (attempt === 3) {
        const stderr = error.stderr?.toString().slice(0, 500) || error.message;
        logError(`Seed failed: ${stderr}`);
        return { ran: false, error: stderr };
      }
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  }
  return { ran: false, error: 'Unknown' };
}

// ─────────────────────────────────────────────────────────────────────
// Process management
// ─────────────────────────────────────────────────────────────────────

async function installDeps(dir, label) {
  if (fs.existsSync(path.join(dir, 'node_modules'))) return true;
  logStep('NPM', `Installing ${label} dependencies...`);
  try {
    execSync('npm install', { cwd: dir, stdio: 'pipe', timeout: 120000 });
    logSuccess(`${label} dependencies installed`);
    return true;
  } catch (error) {
    logError(`npm install failed for ${label}: ${error.stderr?.toString().slice(0, 300) || error.message}`);
    return false;
  }
}

async function startBackend(projectDir, config) {
  const backendDir = path.join(projectDir, 'backend');
  if (!fs.existsSync(backendDir)) return { started: false, error: 'No backend dir' };

  if (!await installDeps(backendDir, 'backend')) {
    return { started: false, error: 'npm install failed' };
  }

  const backendPort = config.backendPort || 3000;
  killProcessOnPort(backendPort);

  logStep('BACKEND', `Starting backend on port ${backendPort}...`);
  const child = spawn('npm', ['run', 'dev'], {
    cwd: backendDir,
    stdio: 'pipe',
    detached: false,
    env: { ...process.env, FORCE_COLOR: '0', PORT: String(backendPort) },
  });

  spawnedProcesses.push({ process: child, name: `${config.name} backend` });

  // Capture stderr for error reporting
  let stderrOutput = '';
  child.stderr.on('data', (data) => {
    stderrOutput += data.toString();
  });

  const ready = await waitForUrl(`http://localhost:${backendPort}`, 30000);
  if (ready) {
    logSuccess(`Backend ready on port ${backendPort}`);
    return { started: true, process: child };
  }

  logError('Backend failed to start within 30s');
  return { started: false, error: stderrOutput.slice(0, 500) || 'Timeout' };
}

async function startFrontend(projectDir, config) {
  const frontendDir = path.join(projectDir, 'frontend');
  if (!fs.existsSync(frontendDir)) return { started: false, error: 'No frontend dir' };

  if (!await installDeps(frontendDir, 'frontend')) {
    return { started: false, error: 'npm install failed' };
  }

  const frontendPort = config.frontendPort || 5173;
  killProcessOnPort(frontendPort);

  logStep('FRONTEND', `Starting frontend on port ${frontendPort}...`);
  const child = spawn('npm', ['run', 'dev'], {
    cwd: frontendDir,
    stdio: 'pipe',
    detached: false,
    env: { ...process.env, FORCE_COLOR: '0' },
  });

  spawnedProcesses.push({ process: child, name: `${config.name} frontend` });

  let stderrOutput = '';
  child.stderr.on('data', (data) => {
    stderrOutput += data.toString();
  });

  const ready = await waitForUrl(`http://localhost:${frontendPort}`, 60000);
  if (ready) {
    logSuccess(`Frontend ready on port ${frontendPort}`);
    return { started: true, process: child };
  }

  logError('Frontend failed to start within 60s');
  return { started: false, error: stderrOutput.slice(0, 500) || 'Timeout' };
}

// ─────────────────────────────────────────────────────────────────────
// Health checks
// ─────────────────────────────────────────────────────────────────────

async function checkFrontendLoads(config) {
  const frontendPort = config.frontendPort || 5173;
  const url = `http://localhost:${frontendPort}`;

  logStep('CHECK', 'Verifying frontend loads...');
  const result = await isUrlReachable(url);
  if (result.ok) {
    logSuccess(`Frontend responds with HTTP ${result.status}`);
    return { ok: true, status: result.status };
  }
  logError(`Frontend returned HTTP ${result.status}`);
  return { ok: false, status: result.status };
}

async function checkLogin(config) {
  if (!config.auth?.enabled) {
    return { ok: true, skipped: true, reason: 'No auth configured' };
  }

  const backendPort = config.backendPort || 3000;
  const creds = config.auth.credentials || {};

  // Try common login endpoints
  const loginEndpoints = [
    '/api/v1/auth/login',
    '/api/auth/login',
    '/api/v1/login',
    '/api/login',
  ];

  // Build login payload
  const payload = {};
  if (creds.email) payload.email = creds.email;
  if (creds.username) payload.username = creds.username;
  if (creds.password) payload.password = creds.password;

  logStep('CHECK', 'Testing login...');

  for (const endpoint of loginEndpoints) {
    const url = `http://localhost:${backendPort}${endpoint}`;
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 10000);

      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
      clearTimeout(timeoutId);

      if (response.ok) {
        logSuccess(`Login succeeded via ${endpoint} (HTTP ${response.status})`);
        return { ok: true, endpoint, status: response.status };
      }

      // 401 means endpoint exists but creds failed
      if (response.status === 401 || response.status === 400) {
        const body = await response.text().catch(() => '');
        logWarning(`Login returned ${response.status} via ${endpoint}: ${body.slice(0, 200)}`);
        return { ok: false, endpoint, status: response.status, error: body.slice(0, 200) };
      }
      // 404 means wrong endpoint, try next
    } catch {
      // Connection refused or timeout, try next
    }
  }

  logError('No working login endpoint found');
  return { ok: false, error: 'No login endpoint responded' };
}

async function checkMainPageContent(config) {
  const frontendPort = config.frontendPort || 5173;
  const url = `http://localhost:${frontendPort}`;

  logStep('CHECK', 'Checking main page content...');
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000);

    const response = await fetch(url, { signal: controller.signal });
    clearTimeout(timeoutId);

    const html = await response.text();

    // Check for common error indicators
    const hasErrorBoundary = html.includes('error-boundary') || html.includes('ErrorBoundary');
    const hasBlankBody = html.includes('<div id="root"></div>') && html.length < 1000;
    const hasReactRoot = html.includes('id="root"') || html.includes('id="app"');

    if (hasErrorBoundary) {
      logWarning('Page contains error boundary');
      return { ok: false, error: 'Error boundary detected' };
    }

    if (hasReactRoot) {
      logSuccess('Main page has React root element');
      return { ok: true, htmlLength: html.length };
    }

    logSuccess(`Main page loaded (${html.length} bytes)`);
    return { ok: true, htmlLength: html.length };
  } catch (error) {
    logError(`Failed to fetch main page: ${error.message}`);
    return { ok: false, error: error.message };
  }
}

async function checkBackendHealth(config) {
  const backendPort = config.backendPort || 3000;

  // Try common health endpoints
  const healthEndpoints = [
    '/api/v1/health',
    '/api/health',
    '/health',
    '/api/v1/status',
  ];

  logStep('CHECK', 'Checking backend health endpoint...');

  for (const endpoint of healthEndpoints) {
    const url = `http://localhost:${backendPort}${endpoint}`;
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5000);
      const response = await fetch(url, { signal: controller.signal });
      clearTimeout(timeoutId);

      if (response.ok) {
        logSuccess(`Health check OK via ${endpoint}`);
        return { ok: true, endpoint };
      }
    } catch {}
  }

  // Fallback: just check if backend root responds
  const rootResult = await isUrlReachable(`http://localhost:${backendPort}`);
  if (rootResult.ok || rootResult.status > 0) {
    logSuccess(`Backend root responds (HTTP ${rootResult.status})`);
    return { ok: true, endpoint: '/', status: rootResult.status };
  }

  logError('No health endpoint found');
  return { ok: false };
}

// ─────────────────────────────────────────────────────────────────────
// Cleanup
// ─────────────────────────────────────────────────────────────────────

function cleanupProcesses() {
  for (const { process: child, name } of spawnedProcesses) {
    if (child && !child.killed) {
      try {
        if (process.platform !== 'win32') {
          // Kill the process group
          try { process.kill(-child.pid, 'SIGTERM'); } catch {}
        }
        child.kill('SIGTERM');
      } catch {}
    }
  }
  spawnedProcesses.length = 0;
}

async function fullCleanup(projectDir, projectName, config) {
  logStep('CLEANUP', 'Stopping all services...');
  cleanupProcesses();
  killProcessOnPort(config.frontendPort || 5173);
  killProcessOnPort(config.backendPort || 3000);
  await stopDockerCompose(projectDir, projectName);
}

// Handle signals
process.on('SIGINT', () => {
  log('\nInterrupted, cleaning up...', 'yellow');
  cleanupProcesses();
  process.exit(130);
});
process.on('SIGTERM', () => { cleanupProcesses(); process.exit(143); });
process.on('exit', () => { cleanupProcesses(); });

// ─────────────────────────────────────────────────────────────────────
// Main triage function for a single project
// ─────────────────────────────────────────────────────────────────────

async function triageProject(projectName, config) {
  const projectDir = path.join(repoRoot, projectName);
  const startTime = Date.now();

  const result = {
    project: projectName,
    timestamp: new Date().toISOString(),
    hasConfig: !!config,
    hasDockerCompose: hasDockerCompose(projectDir),
    hasSeedSql: false,
    hasInitSql: false,
    dockerUp: false,
    postgresReady: false,
    redisReady: false,
    migrationOk: false,
    seedOk: false,
    backendStarted: false,
    frontendStarted: false,
    frontendLoads: false,
    backendHealthOk: false,
    loginOk: false,
    mainPageOk: false,
    errors: [],
    duration: 0,
    grade: 'RED',
  };

  // Check for seed/init files
  const seedPaths = [
    path.join(projectDir, 'backend', 'db-seed', 'seed.sql'),
    path.join(projectDir, 'backend', 'seed.sql'),
    path.join(projectDir, 'backend', 'db', 'seed.sql'),
  ];
  const initPaths = [
    path.join(projectDir, 'backend', 'src', 'db', 'init.sql'),
    path.join(projectDir, 'backend', 'db', 'init.sql'),
    path.join(projectDir, 'backend', 'init.sql'),
    path.join(projectDir, 'backend', 'scripts', 'init.sql'),
  ];
  result.hasSeedSql = seedPaths.some(p => fs.existsSync(p));
  result.hasInitSql = initPaths.some(p => fs.existsSync(p));

  // Use config if available, otherwise create a minimal one
  const effectiveConfig = config || {
    name: projectName,
    frontendPort: 5173,
    backendPort: 3000,
    backendRequired: true,
    dbName: projectName.replace(/-/g, '_'),
    dbUser: 'user',
    auth: { enabled: true },
  };

  console.log('\n' + '═'.repeat(60));
  log(`  TRIAGE: ${projectName}`, 'bold');
  console.log('═'.repeat(60));

  try {
    // 1. Stop existing Docker
    await stopDockerCompose(projectDir, projectName);

    // 2. Start Docker
    if (result.hasDockerCompose) {
      const dockerResult = await startDockerCompose(projectDir, projectName);
      result.dockerUp = dockerResult.started;
      if (!dockerResult.started) {
        result.errors.push(`Docker: ${dockerResult.error}`);
      }
    } else {
      result.errors.push('No docker-compose.yml');
    }

    // 3. Wait for PostgreSQL + Redis
    if (result.dockerUp) {
      result.postgresReady = await waitForPostgres(projectDir, effectiveConfig);
      if (!result.postgresReady) result.errors.push('PostgreSQL not ready');

      result.redisReady = await waitForRedis(projectDir);
      if (!result.redisReady) result.errors.push('Redis not ready');
    }

    // 4. Run migration
    if (result.postgresReady) {
      const migResult = await runMigration(projectDir, effectiveConfig);
      result.migrationOk = migResult.ran || migResult.reason === 'No db:migrate script';
      if (migResult.error) result.errors.push(`Migration: ${migResult.error}`);
    }

    // 5. Run seed
    if (result.postgresReady) {
      const seedResult = await runSeed(projectDir, effectiveConfig);
      result.seedOk = seedResult.ran || seedResult.reason === 'No seed.sql found';
      if (seedResult.error) result.errors.push(`Seed: ${seedResult.error}`);
    }

    // 6. Start backend
    const backendResult = await startBackend(projectDir, effectiveConfig);
    result.backendStarted = backendResult.started;
    if (!backendResult.started) {
      result.errors.push(`Backend: ${backendResult.error}`);
    }

    // 7. Start frontend
    const frontendResult = await startFrontend(projectDir, effectiveConfig);
    result.frontendStarted = frontendResult.started;
    if (!frontendResult.started) {
      result.errors.push(`Frontend: ${frontendResult.error}`);
    }

    // 8. Health checks
    if (result.frontendStarted) {
      const frontendCheck = await checkFrontendLoads(effectiveConfig);
      result.frontendLoads = frontendCheck.ok;
    }

    if (result.backendStarted) {
      const healthCheck = await checkBackendHealth(effectiveConfig);
      result.backendHealthOk = healthCheck.ok;

      const loginCheck = await checkLogin(effectiveConfig);
      result.loginOk = loginCheck.ok || loginCheck.skipped;
      if (!loginCheck.ok && !loginCheck.skipped) {
        result.errors.push(`Login: ${loginCheck.error || `HTTP ${loginCheck.status}`}`);
      }
    }

    if (result.frontendLoads) {
      const mainPageCheck = await checkMainPageContent(effectiveConfig);
      result.mainPageOk = mainPageCheck.ok;
    }

  } catch (error) {
    result.errors.push(`Unexpected: ${error.message}`);
  } finally {
    await fullCleanup(projectDir, projectName, effectiveConfig);
  }

  // Calculate grade
  result.grade = calculateGrade(result);
  result.duration = Math.round((Date.now() - startTime) / 1000);

  // Print summary
  printProjectSummary(result);

  return result;
}

// ─────────────────────────────────────────────────────────────────────
// Grading
// ─────────────────────────────────────────────────────────────────────

function calculateGrade(result) {
  // GREEN: Everything works
  if (result.dockerUp && result.backendStarted && result.frontendStarted &&
      result.frontendLoads && result.loginOk && result.mainPageOk) {
    return 'GREEN';
  }

  // YELLOW: Frontend/backend start, minor issues (login fails or minor health issues)
  if (result.backendStarted && result.frontendStarted && result.frontendLoads) {
    return 'YELLOW';
  }

  // ORANGE: Docker works, but backend or frontend fails to start
  if (result.dockerUp && (result.backendStarted || result.frontendStarted)) {
    return 'ORANGE';
  }

  // RED: Nothing works
  return 'RED';
}

function gradeColor(grade) {
  switch (grade) {
    case 'GREEN': return 'bgGreen';
    case 'YELLOW': return 'bgYellow';
    case 'ORANGE': return 'bgMagenta';
    case 'RED': return 'bgRed';
    default: return 'reset';
  }
}

function printProjectSummary(result) {
  console.log('');
  log(`  ${result.grade}  ${result.project}`, gradeColor(result.grade));
  console.log(`  Docker: ${result.dockerUp ? '✓' : '✗'}  PG: ${result.postgresReady ? '✓' : '✗'}  Redis: ${result.redisReady ? '✓' : '✗'}  Migrate: ${result.migrationOk ? '✓' : '✗'}  Seed: ${result.seedOk ? '✓' : '✗'}`);
  console.log(`  Backend: ${result.backendStarted ? '✓' : '✗'}  Frontend: ${result.frontendStarted ? '✓' : '✗'}  Login: ${result.loginOk ? '✓' : '✗'}  Health: ${result.backendHealthOk ? '✓' : '✗'}  Page: ${result.mainPageOk ? '✓' : '✗'}`);
  if (result.errors.length > 0) {
    console.log(`  Errors: ${result.errors.length}`);
    result.errors.forEach(e => logError(`  ${e.slice(0, 120)}`));
  }
  console.log(`  Duration: ${result.duration}s`);
}

// ─────────────────────────────────────────────────────────────────────
// Report handling
// ─────────────────────────────────────────────────────────────────────

function loadExistingReport() {
  if (fs.existsSync(reportPath)) {
    return JSON.parse(fs.readFileSync(reportPath, 'utf-8'));
  }
  return { generated: new Date().toISOString(), projects: {} };
}

function saveReport(report) {
  report.generated = new Date().toISOString();
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
  logSuccess(`Report saved to ${reportPath}`);
}

function printReport(report) {
  console.log('\n' + '═'.repeat(60));
  log('  TRIAGE REPORT SUMMARY', 'bold');
  console.log('═'.repeat(60));
  console.log(`  Generated: ${report.generated}`);
  console.log('');

  const projects = Object.values(report.projects);
  const green = projects.filter(p => p.grade === 'GREEN');
  const yellow = projects.filter(p => p.grade === 'YELLOW');
  const orange = projects.filter(p => p.grade === 'ORANGE');
  const red = projects.filter(p => p.grade === 'RED');

  log(`  GREEN  (${green.length}): Everything works`, 'green');
  green.forEach(p => console.log(`    ✓ ${p.project}`));
  console.log('');

  log(`  YELLOW (${yellow.length}): Minor issues`, 'yellow');
  yellow.forEach(p => console.log(`    ⚠ ${p.project} — ${p.errors[0] || 'check details'}`));
  console.log('');

  log(`  ORANGE (${orange.length}): Partially broken`, 'magenta');
  orange.forEach(p => console.log(`    ⚠ ${p.project} — ${p.errors[0] || 'check details'}`));
  console.log('');

  log(`  RED    (${red.length}): Broken`, 'red');
  red.forEach(p => console.log(`    ✗ ${p.project} — ${p.errors[0] || 'check details'}`));
  console.log('');

  console.log(`  Total: ${projects.length} projects triaged`);
  console.log('═'.repeat(60));
}

// ─────────────────────────────────────────────────────────────────────
// Main
// ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log('\n🏥 Project Triage Script\n');

  const configs = loadConfigs();
  const configMap = Object.fromEntries(configs.map(c => [c.name, c]));

  // --list mode
  if (isList) {
    const projects = discoverProjects();
    log(`Found ${projects.length} full-stack projects:\n`, 'cyan');
    for (const p of projects) {
      const config = configMap[p.name];
      const tags = [
        p.hasDocker ? 'docker' : null,
        p.hasConfig ? 'config' : null,
        config?.auth?.enabled ? 'auth' : null,
      ].filter(Boolean).join(', ');
      console.log(`  ${p.name.padEnd(25)} ${colors.dim}[${tags}]${colors.reset}`);
    }
    console.log('');
    console.log(`Waves:`);
    for (const [num, wave] of Object.entries(waves)) {
      console.log(`  Wave ${num}: ${wave.join(', ')}`);
    }
    return;
  }

  // --report mode
  if (isReport) {
    const report = loadExistingReport();
    if (Object.keys(report.projects).length === 0) {
      logWarning('No triage report found. Run triage first.');
    } else {
      printReport(report);
    }
    return;
  }

  // Determine which projects to triage
  let projectNames = [];

  if (isAll) {
    projectNames = discoverProjects().map(p => p.name);
  } else if (waveNum !== null) {
    projectNames = waves[waveNum] || [];
    if (projectNames.length === 0) {
      logError(`Unknown wave: ${waveNum}. Available: ${Object.keys(waves).join(', ')}`);
      process.exit(1);
    }
    log(`Wave ${waveNum}: ${projectNames.join(', ')}`, 'cyan');
  } else if (projectArgs.length > 0) {
    projectNames = projectArgs;
  } else {
    log('Usage: node scripts/triage-projects.mjs [--all | --wave N | project1 project2 ...]', 'yellow');
    log('       node scripts/triage-projects.mjs --list    # List available projects', 'yellow');
    log('       node scripts/triage-projects.mjs --report  # Show last report', 'yellow');
    process.exit(1);
  }

  // Validate projects exist
  const validProjects = projectNames.filter(name => {
    const projectDir = path.join(repoRoot, name);
    if (!fs.existsSync(projectDir)) {
      logWarning(`Project directory not found: ${name}`);
      return false;
    }
    return true;
  });

  if (validProjects.length === 0) {
    logError('No valid projects to triage');
    process.exit(1);
  }

  log(`Triaging ${validProjects.length} project(s)...\n`, 'cyan');

  // Load or create report
  const report = loadExistingReport();

  // Triage each project sequentially
  const results = [];
  for (const projectName of validProjects) {
    const config = configMap[projectName] || null;
    const result = await triageProject(projectName, config);
    report.projects[projectName] = result;
    results.push(result);

    // Save incrementally
    saveReport(report);
  }

  // Print summary
  printReport(report);
}

main().catch(error => {
  logError(`Fatal: ${error.message}`);
  cleanupProcesses();
  process.exit(1);
});
