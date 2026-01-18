#!/usr/bin/env node
/**
 * Run Playwright smoke tests for frontend projects with full infrastructure setup.
 * Handles Docker, database seeding, and backend startup similar to screenshots.mjs.
 *
 * Usage:
 *   node scripts/run-smoke-tests.mjs <project>       # Run tests for specific project
 *   node scripts/run-smoke-tests.mjs --all           # Run tests for all projects
 *   node scripts/run-smoke-tests.mjs --list          # List available projects
 *
 * Automated Workflow:
 *   1. Stop Docker containers (clean slate)
 *   2. Start Docker services (PostgreSQL, Redis, etc.)
 *   3. Setup database (run init.sql + seed.sql if exists)
 *   4. Start backend server (if backendRequired in config)
 *   5. Run Playwright tests
 *   6. Stop frontend, backend, and Docker services
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { spawn, execSync } from 'child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');
const configDir = path.join(__dirname, 'screenshot-configs');

// CLI argument parsing
const args = process.argv.slice(2);
const isAll = args.includes('--all');
const isList = args.includes('--list');
const projectArgs = args.filter(arg => !arg.startsWith('--'));

// Track spawned processes for cleanup
const spawnedProcesses = [];

// Colors for console output
const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  cyan: '\x1b[36m',
  dim: '\x1b[2m',
};

function log(message, color = 'reset') {
  console.log(`${colors[color]}${message}${colors.reset}`);
}

function logStep(step, message) {
  console.log(`${colors.cyan}[${step}]${colors.reset} ${message}`);
}

function logSuccess(message) {
  console.log(`${colors.green}✓${colors.reset} ${message}`);
}

function logWarning(message) {
  console.log(`${colors.yellow}⚠${colors.reset} ${message}`);
}

function logError(message) {
  console.log(`${colors.red}✗${colors.reset} ${message}`);
}

/**
 * Load all available project configurations
 */
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
 * Check if a URL is reachable
 */
async function isUrlReachable(url, timeout = 5000) {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    const response = await fetch(url, {
      method: 'HEAD',
      signal: controller.signal,
    });

    clearTimeout(timeoutId);
    return response.ok || response.status === 404;
  } catch {
    return false;
  }
}

/**
 * Wait for a URL to be ready
 */
async function waitForUrl(url, maxWait = 60000) {
  const startTime = Date.now();

  while (Date.now() - startTime < maxWait) {
    if (await isUrlReachable(url)) {
      return true;
    }
    await new Promise(resolve => setTimeout(resolve, 1000));
  }

  return false;
}

/**
 * Check if docker-compose is available and Docker is running
 */
function hasDockerCompose(projectDir) {
  return fs.existsSync(path.join(projectDir, 'docker-compose.yml')) ||
         fs.existsSync(path.join(projectDir, 'docker-compose.yaml'));
}

function isDockerRunning() {
  try {
    execSync('docker info', { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

/**
 * Kill any process using a specific port
 */
function killProcessOnPort(port) {
  try {
    if (process.platform === 'darwin' || process.platform === 'linux') {
      const result = execSync(`lsof -ti:${port}`, { encoding: 'utf-8' }).trim();
      if (result) {
        const pids = result.split('\n');
        pids.forEach(pid => {
          try {
            execSync(`kill -9 ${pid}`, { stdio: 'pipe' });
          } catch {}
        });
      }
    }
  } catch {
    // No process found on port
  }
}

/**
 * Stop docker-compose services
 */
async function stopDockerCompose(projectDir, projectName) {
  if (!hasDockerCompose(projectDir)) {
    return true;
  }

  if (!isDockerRunning()) {
    return true;
  }

  logStep('DOCKER', `Stopping infrastructure for ${projectName}...`);

  try {
    execSync('docker-compose down -v --remove-orphans', {
      cwd: projectDir,
      stdio: 'pipe',
      timeout: 60000,
    });
    logSuccess('Docker services stopped');
    await new Promise(resolve => setTimeout(resolve, 3000));
    return true;
  } catch (error) {
    logWarning(`Docker-compose stop failed: ${error.message}`);
    return true;
  }
}

/**
 * Start docker-compose services
 */
async function startDockerCompose(projectDir, projectName) {
  if (!hasDockerCompose(projectDir)) {
    return false;
  }

  if (!isDockerRunning()) {
    logWarning('Docker is not running, skipping docker-compose');
    return false;
  }

  logStep('DOCKER', `Starting infrastructure for ${projectName}...`);

  try {
    execSync('docker-compose up -d', {
      cwd: projectDir,
      stdio: 'pipe',
    });
    logSuccess('Docker services started');
    await new Promise(resolve => setTimeout(resolve, 5000));
    return true;
  } catch (error) {
    logWarning(`Docker-compose failed: ${error.message}`);
    return false;
  }
}

/**
 * Setup database
 */
async function setupDatabase(projectDir, projectName, config) {
  const backendDir = path.join(projectDir, 'backend');

  // Look for init.sql and seed.sql in common locations
  const initSqlPaths = [
    path.join(backendDir, 'init.sql'),
    path.join(backendDir, 'db', 'init.sql'),
    path.join(backendDir, 'src', 'db', 'init.sql'),
    path.join(projectDir, 'db', 'init.sql'),
  ];

  const seedSqlPaths = [
    path.join(backendDir, 'seed.sql'),
    path.join(backendDir, 'db', 'seed.sql'),
    path.join(backendDir, 'db-seed', 'seed.sql'),
    path.join(projectDir, 'db', 'seed.sql'),
  ];

  const initSqlPath = initSqlPaths.find(p => fs.existsSync(p));
  const seedSqlPath = seedSqlPaths.find(p => fs.existsSync(p));

  if (!initSqlPath && !seedSqlPath) {
    return true;
  }

  // Get database credentials from config or use defaults
  const dbName = config.dbName || projectName.replace(/-/g, '_');
  const dbUser = config.dbUser || projectName.replace(/-/g, '_');
  const containerName = `${projectName}-postgres`;

  // Wait for PostgreSQL to be ready
  logStep('DATABASE', 'Waiting for database to be ready...');
  let dbReady = false;
  for (let i = 0; i < 15; i++) {
    try {
      execSync(`docker exec ${containerName} pg_isready -U ${dbUser}`, {
        stdio: 'pipe',
      });
      dbReady = true;
      break;
    } catch {
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  }

  if (!dbReady) {
    logWarning('Database not ready after 15 seconds');
    return false;
  }

  // Run init.sql if found
  if (initSqlPath) {
    logStep('DATABASE', 'Running init.sql...');
    try {
      execSync(`docker exec -i ${containerName} psql -U ${dbUser} -d ${dbName} < "${initSqlPath}"`, {
        cwd: projectDir,
        stdio: 'pipe',
        shell: true,
      });
      logSuccess('Database initialized');
    } catch (error) {
      logWarning(`init.sql failed: ${error.message}`);
    }
  }

  // Run seed.sql if found
  if (seedSqlPath) {
    logStep('DATABASE', 'Running seed.sql...');
    try {
      execSync(`docker exec -i ${containerName} psql -U ${dbUser} -d ${dbName} < "${seedSqlPath}"`, {
        cwd: projectDir,
        stdio: 'pipe',
        shell: true,
      });
      logSuccess('Database seeded');
    } catch (error) {
      logWarning(`seed.sql failed: ${error.message}`);
    }
  }

  return true;
}

/**
 * Install dependencies if needed
 */
async function installDeps(dir, name = 'dependencies') {
  const nodeModulesPath = path.join(dir, 'node_modules');

  if (fs.existsSync(nodeModulesPath)) {
    return true;
  }

  logStep('NPM', `Installing ${name}...`);

  try {
    execSync('npm install', {
      cwd: dir,
      stdio: 'pipe',
    });
    logSuccess(`${name} installed`);
    return true;
  } catch (error) {
    logError(`npm install failed: ${error.message}`);
    return false;
  }
}

/**
 * Start backend server
 */
async function startBackend(projectDir, projectName, config) {
  if (!config.backendRequired) {
    return null;
  }

  const backendDir = path.join(projectDir, 'backend');
  if (!fs.existsSync(backendDir)) {
    return null;
  }

  // Install dependencies
  await installDeps(backendDir, 'backend dependencies');

  const backendPort = config.backendPort || 3000;

  // Kill any existing process on the port
  killProcessOnPort(backendPort);

  logStep('BACKEND', `Starting backend server on port ${backendPort}...`);

  const backendProcess = spawn('npm', ['run', 'dev'], {
    cwd: backendDir,
    stdio: 'pipe',
    shell: true,
    env: { ...process.env, PORT: String(backendPort) },
  });

  spawnedProcesses.push(backendProcess);

  // Wait for backend to be ready
  const backendUrl = `http://localhost:${backendPort}`;
  const ready = await waitForUrl(backendUrl, 30000);

  if (ready) {
    logSuccess(`Backend ready at ${backendUrl}`);
  } else {
    logWarning('Backend may not be fully ready');
  }

  return backendProcess;
}

/**
 * Start frontend dev server
 */
async function startFrontend(projectDir, projectName, config) {
  const frontendDir = path.join(projectDir, 'frontend');
  if (!fs.existsSync(frontendDir)) {
    logError('No frontend directory found');
    return null;
  }

  // Install dependencies
  await installDeps(frontendDir, 'frontend dependencies');

  const frontendPort = config.frontendPort || 5173;

  // Kill any existing process on the port
  killProcessOnPort(frontendPort);

  logStep('FRONTEND', `Starting frontend server on port ${frontendPort}...`);

  const frontendProcess = spawn('npm', ['run', 'dev'], {
    cwd: frontendDir,
    stdio: 'pipe',
    shell: true,
  });

  spawnedProcesses.push(frontendProcess);

  // Wait for frontend to be ready
  const frontendUrl = `http://localhost:${frontendPort}`;
  const ready = await waitForUrl(frontendUrl, 60000);

  if (ready) {
    logSuccess(`Frontend ready at ${frontendUrl}`);
  } else {
    logError('Frontend failed to start');
    return null;
  }

  return frontendProcess;
}

/**
 * Run Playwright tests
 */
async function runPlaywrightTests(projectDir, projectName) {
  const testsDir = path.join(projectDir, 'tests');
  const playwrightConfig = path.join(projectDir, 'playwright.config.ts');

  if (!fs.existsSync(testsDir) || !fs.existsSync(playwrightConfig)) {
    logError(`No tests found for ${projectName}. Run 'npm run generate-tests ${projectName}' first.`);
    return false;
  }

  // Install test dependencies
  await installDeps(projectDir, 'test dependencies');

  logStep('TEST', `Running Playwright tests for ${projectName}...`);

  try {
    // Run playwright directly, skipping webServer since we manage it ourselves
    execSync('npx playwright test --reporter=line', {
      cwd: projectDir,
      stdio: 'inherit',
      env: {
        ...process.env,
        // Skip webServer config in playwright.config.ts
        SKIP_WEBSERVER: '1',
      },
    });
    logSuccess(`All tests passed for ${projectName}`);
    return true;
  } catch (error) {
    logError(`Tests failed for ${projectName}`);
    return false;
  }
}

/**
 * Cleanup all spawned processes
 */
function cleanup() {
  for (const proc of spawnedProcesses) {
    try {
      proc.kill('SIGTERM');
    } catch {}
  }
  spawnedProcesses.length = 0;
}

/**
 * Run tests for a single project
 */
async function runTestsForProject(config) {
  const projectDir = path.join(repoRoot, config.name);

  if (!fs.existsSync(projectDir)) {
    logError(`Project directory not found: ${config.name}`);
    return false;
  }

  console.log('\n' + '═'.repeat(60));
  log(`Testing: ${config.name}`, 'cyan');
  console.log('═'.repeat(60));

  let dockerStarted = false;
  let backendProcess = null;
  let frontendProcess = null;

  try {
    // Step 1: Stop existing Docker services
    await stopDockerCompose(projectDir, config.name);

    // Step 2: Start Docker services
    dockerStarted = await startDockerCompose(projectDir, config.name);

    // Step 3: Setup database
    if (dockerStarted) {
      await setupDatabase(projectDir, config.name, config);
    }

    // Step 4: Start backend (if required)
    backendProcess = await startBackend(projectDir, config.name, config);

    // Step 5: Start frontend
    frontendProcess = await startFrontend(projectDir, config.name, config);
    if (!frontendProcess) {
      throw new Error('Frontend failed to start');
    }

    // Step 6: Run Playwright tests
    const success = await runPlaywrightTests(projectDir, config.name);

    return success;
  } catch (error) {
    logError(`Error: ${error.message}`);
    return false;
  } finally {
    // Cleanup
    logStep('CLEANUP', 'Stopping services...');

    cleanup();

    // Kill processes on common ports
    killProcessOnPort(config.frontendPort || 5173);
    killProcessOnPort(config.backendPort || 3000);

    if (dockerStarted) {
      await stopDockerCompose(projectDir, config.name);
    }
  }
}

/**
 * Main function
 */
async function main() {
  console.log('\n🧪 Playwright Smoke Test Runner\n');

  // Load configurations
  const configs = loadConfigs();

  if (configs.length === 0) {
    logError('No project configurations found in scripts/screenshot-configs/');
    process.exit(1);
  }

  // List mode
  if (isList) {
    log('Available projects:', 'cyan');
    configs.forEach(config => {
      const testsDir = path.join(repoRoot, config.name, 'tests');
      const hasTests = fs.existsSync(testsDir);
      const status = hasTests ? colors.green + '✓' + colors.reset : colors.dim + '(no tests)' + colors.reset;
      log(`  ${status} ${config.name}`);
    });
    return;
  }

  // Determine which projects to test
  let projectsToTest;
  if (isAll) {
    // Only test projects that have tests generated
    projectsToTest = configs.filter(c => {
      const testsDir = path.join(repoRoot, c.name, 'tests');
      return fs.existsSync(testsDir);
    });
  } else if (projectArgs.length > 0) {
    projectsToTest = configs.filter(c => projectArgs.includes(c.name));
    const notFound = projectArgs.filter(p => !configs.find(c => c.name === p));
    if (notFound.length > 0) {
      logError(`Configuration not found for: ${notFound.join(', ')}`);
      log('Available: ' + configs.map(c => c.name).join(', '), 'dim');
      process.exit(1);
    }
  } else {
    log('Usage: node scripts/run-smoke-tests.mjs <project> [--all]', 'yellow');
    log('\nAvailable projects:', 'cyan');
    configs.forEach(c => log(`  • ${c.name}`));
    process.exit(0);
  }

  if (projectsToTest.length === 0) {
    logError('No projects with tests found. Run "npm run generate-tests" first.');
    process.exit(1);
  }

  // Handle cleanup on exit
  process.on('SIGINT', () => {
    console.log('\n');
    logWarning('Interrupted, cleaning up...');
    cleanup();
    process.exit(1);
  });

  let passed = 0;
  let failed = 0;

  for (const config of projectsToTest) {
    const success = await runTestsForProject(config);
    if (success) {
      passed++;
    } else {
      failed++;
    }
  }

  // Summary
  console.log('\n' + '═'.repeat(60));
  log('Test Summary', 'cyan');
  console.log('═'.repeat(60));
  log(`Passed: ${passed}`, 'green');
  if (failed > 0) {
    log(`Failed: ${failed}`, 'red');
  }

  process.exit(failed > 0 ? 1 : 0);
}

main().catch(error => {
  logError(`Fatal error: ${error.message}`);
  cleanup();
  process.exit(1);
});
