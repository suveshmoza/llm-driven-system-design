import { chromium } from 'playwright';
import { mkdir } from 'fs/promises';
import { join } from 'path';
import { spawn, execSync } from 'child_process';

const SCREENSHOTS_DIR = join(process.cwd(), 'docs', 'screenshots');
const BASE_URL = 'http://localhost:5173';
const REMOTE_DEBUGGING_PORT = 9222;

async function waitForPort(port: number, maxWait = 10000): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < maxWait) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/version`);
      if (response.ok) return true;
    } catch {
      // Port not ready yet
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  return false;
}

async function launchChromeWithOpen(): Promise<void> {
  // Kill any existing Chrome with debugging port
  try {
    execSync('pkill -f "remote-debugging-port"', { stdio: 'ignore' });
  } catch {
    // No process to kill
  }

  return new Promise((resolve, reject) => {
    const userDataDir = `/tmp/chrome-playwright-${Date.now()}`;
    const args = [
      '-na', 'Google Chrome',
      '--args',
      `--remote-debugging-port=${REMOTE_DEBUGGING_PORT}`,
      '--no-first-run',
      '--no-default-browser-check',
      `--user-data-dir=${userDataDir}`,
    ];

    console.log('Starting Chrome with:', args.join(' '));
    const proc = spawn('open', args, { detached: true, stdio: 'ignore' });
    proc.on('error', reject);
    proc.unref();

    // Wait a bit then resolve
    setTimeout(resolve, 2000);
  });
}

async function takeScreenshots() {
  // Create screenshots directory
  await mkdir(SCREENSHOTS_DIR, { recursive: true });

  console.log('Launching Chrome via open command...');
  await launchChromeWithOpen();

  console.log('Waiting for Chrome debugging port...');
  const ready = await waitForPort(REMOTE_DEBUGGING_PORT);
  if (!ready) {
    throw new Error('Chrome debugging port not available');
  }

  console.log('Connecting to browser...');
  const browser = await chromium.connectOverCDP(`http://127.0.0.1:${REMOTE_DEBUGGING_PORT}`);
  const context = await browser.newContext({
    viewport: { width: 1280, height: 800 },
  });
  const page = await context.newPage();

  console.log('Loading page...');
  await page.goto(BASE_URL, { waitUntil: 'networkidle', timeout: 30000 });

  // Wait for UI to stabilize
  await page.waitForTimeout(1500);

  // Screenshot 1: Default view (light mode)
  console.log('Taking screenshot: 01-main-light.png');
  await page.screenshot({
    path: join(SCREENSHOTS_DIR, '01-main-light.png'),
  });

  // Type some sample text
  const textarea = page.locator('textarea');
  if (await textarea.count() > 0) {
    await textarea.click();
    await textarea.fill('The quick brown fox jumps over the lazy dog.\n\nThis is a pluggable text editor where everything is a plugin!\n\nYou can change fonts, paper styles, and themes.');
    await page.waitForTimeout(500);
  }

  // Screenshot 2: With text content
  console.log('Taking screenshot: 02-with-content.png');
  await page.screenshot({
    path: join(SCREENSHOTS_DIR, '02-with-content.png'),
  });

  // Click theme toggle to switch to dark mode
  const darkButton = page.locator('button', { hasText: 'Dark' });
  if (await darkButton.count() > 0) {
    await darkButton.click();
    await page.waitForTimeout(500);
  }

  // Screenshot 3: Dark mode
  console.log('Taking screenshot: 03-dark-mode.png');
  await page.screenshot({
    path: join(SCREENSHOTS_DIR, '03-dark-mode.png'),
  });

  // Change paper style to ruled
  const paperSelect = page.locator('#paper-select');
  if (await paperSelect.count() > 0) {
    await paperSelect.selectOption('ruled');
    await page.waitForTimeout(500);
  }

  // Screenshot 4: Ruled paper dark mode
  console.log('Taking screenshot: 04-ruled-dark.png');
  await page.screenshot({
    path: join(SCREENSHOTS_DIR, '04-ruled-dark.png'),
  });

  // Switch to light mode
  const lightButton = page.locator('button', { hasText: 'Light' });
  if (await lightButton.count() > 0) {
    await lightButton.click();
    await page.waitForTimeout(500);
  }

  // Change to graph paper
  if (await paperSelect.count() > 0) {
    await paperSelect.selectOption('graph');
    await page.waitForTimeout(500);
  }

  // Screenshot 5: Graph paper light
  console.log('Taking screenshot: 05-graph-light.png');
  await page.screenshot({
    path: join(SCREENSHOTS_DIR, '05-graph-light.png'),
  });

  // Change to legal pad
  if (await paperSelect.count() > 0) {
    await paperSelect.selectOption('legal');
    await page.waitForTimeout(500);
  }

  // Screenshot 6: Legal pad
  console.log('Taking screenshot: 06-legal-pad.png');
  await page.screenshot({
    path: join(SCREENSHOTS_DIR, '06-legal-pad.png'),
  });

  // Change font
  const fontSelect = page.locator('#font-select');
  if (await fontSelect.count() > 0) {
    await fontSelect.selectOption('mono');
    await page.waitForTimeout(500);
  }

  // Screenshot 7: Monospace font
  console.log('Taking screenshot: 07-mono-font.png');
  await page.screenshot({
    path: join(SCREENSHOTS_DIR, '07-mono-font.png'),
  });

  // Click Plugins button
  const pluginsButton = page.locator('button', { hasText: 'Plugins' });
  if (await pluginsButton.count() > 0) {
    await pluginsButton.click();
    await page.waitForTimeout(1000);

    // Screenshot 8: Marketplace modal
    console.log('Taking screenshot: 08-marketplace.png');
    await page.screenshot({
      path: join(SCREENSHOTS_DIR, '08-marketplace.png'),
    });

    // Close modal by pressing Escape
    await page.keyboard.press('Escape');
    await page.waitForTimeout(500);
  }

  // Click Sign in
  const signInButton = page.locator('button', { hasText: 'Sign in' });
  if (await signInButton.count() > 0) {
    await signInButton.click();
    await page.waitForTimeout(500);

    // Screenshot 9: Auth modal
    console.log('Taking screenshot: 09-auth-modal.png');
    await page.screenshot({
      path: join(SCREENSHOTS_DIR, '09-auth-modal.png'),
    });
  }

  await context.close();
  await browser.close();
  console.log('\n✓ Screenshots saved to:', SCREENSHOTS_DIR);
}

takeScreenshots().catch((err) => {
  console.error('Error taking screenshots:', err);
  process.exit(1);
});
