/**
 * CLI Interface - Terminal interaction layer for evylcode
 */

import * as readline from 'readline';
import chalk from 'chalk';
import ora, { type Ora } from 'ora';
import type { CLIConfig } from '../types/index.js';

const VERSION = '1.0.0';

// ASCII art logo for evylcode
const LOGO = `
${chalk.hex('#FF6B6B')('   _____ _    _ __     __ _      ')}${chalk.hex('#4ECDC4')('  _____ ____  _____  ______ ')}
${chalk.hex('#FF6B6B')('  |  ___| |  | |\\ \\   / /| |     ')}${chalk.hex('#4ECDC4')(' / ____/ __ \\|  __ \\|  ____|')}
${chalk.hex('#FF6B6B')('  | |__ | |  | | \\ \\_/ / | |     ')}${chalk.hex('#4ECDC4')('| |   | |  | | |  | | |__   ')}
${chalk.hex('#FF6B6B')('  |  __|| |  | |  \\   /  | |     ')}${chalk.hex('#4ECDC4')('| |   | |  | | |  | |  __|  ')}
${chalk.hex('#FF6B6B')('  | |___| |__| |   | |   | |____ ')}${chalk.hex('#4ECDC4')('| |___| |__| | |__| | |____ ')}
${chalk.hex('#FF6B6B')('  |______\\____/    |_|   |______|')}${chalk.hex('#4ECDC4')(' \\_____\\____/|_____/|______|')}
`;

export class CLIInterface {
  private rl: readline.Interface;
  private spinner: Ora | null = null;
  private config: CLIConfig;

  constructor(config: Partial<CLIConfig> = {}) {
    this.config = {
      theme: 'dark',
      colorOutput: true,
      verbosity: 'normal',
      streamResponses: true,
      confirmBeforeWrite: true,
      autoApproveReads: true,
      saveHistory: true,
      historyPath: '.evylcode-history',
      ...config,
    };

    this.rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      terminal: true,
    });
  }

  /**
   * Display welcome banner
   */
  showWelcome(): void {
    console.log(LOGO);
    console.log();
    console.log(
      chalk.gray('  ') +
      chalk.bold.white('evylcode CLI') +
      chalk.gray(` v${VERSION}`) +
      chalk.gray(' - AI-Powered Coding Assistant')
    );
    console.log();
    console.log(chalk.gray('  Powered by ') + chalk.hex('#CC785C')('Claude') + chalk.gray(' from Anthropic'));
    console.log();
    console.log(chalk.hex('#555555')('  ─────────────────────────────────────────────────────────────'));
    console.log();
    console.log(
      chalk.gray('  ') +
      chalk.hex('#4ECDC4')('Commands: ') +
      chalk.white('/help') +
      chalk.gray(' | ') +
      chalk.white('/clear') +
      chalk.gray(' | ') +
      chalk.white('/session') +
      chalk.gray(' | ') +
      chalk.white('/exit')
    );
    console.log();
    console.log(chalk.hex('#555555')('  ─────────────────────────────────────────────────────────────'));
    console.log();
  }

  /**
   * Show a greeting message
   */
  showGreeting(): void {
    const hour = new Date().getHours();
    let greeting: string;
    let emoji: string;

    if (hour < 12) {
      greeting = 'Good morning';
      emoji = ''; // sunrise
    } else if (hour < 17) {
      greeting = 'Good afternoon';
      emoji = ''; // sun
    } else if (hour < 21) {
      greeting = 'Good evening';
      emoji = ''; // sunset
    } else {
      greeting = 'Burning the midnight oil';
      emoji = ''; // moon
    }

    console.log(
      chalk.gray('  ') +
      chalk.hex('#4ECDC4')(emoji + ' ' + greeting + '!') +
      chalk.gray(" Let's build something amazing.")
    );
    console.log();
  }

  /**
   * Prompt for user input with styled prompt
   */
  async prompt(promptText: string = ''): Promise<string> {
    const styledPrompt = promptText || (
      chalk.hex('#FF6B6B')('evyl') +
      chalk.hex('#4ECDC4')('code') +
      chalk.gray(' > ')
    );

    return new Promise((resolve) => {
      this.rl.question(styledPrompt, (answer) => {
        resolve(answer);
      });
    });
  }

  /**
   * Confirm an action with the user
   */
  async confirm(description: string): Promise<boolean> {
    console.log();
    console.log(chalk.hex('#FFE66D')('  ┌─') + chalk.hex('#FFE66D').bold(' Permission Required ') + chalk.hex('#FFE66D')('──────────────────────────────────────┐'));
    console.log(chalk.hex('#FFE66D')('  │'));
    console.log(chalk.hex('#FFE66D')('  │  ') + chalk.white(description));
    console.log(chalk.hex('#FFE66D')('  │'));
    console.log(chalk.hex('#FFE66D')('  └──────────────────────────────────────────────────────────────┘'));
    console.log();

    const answer = await this.prompt(
      chalk.hex('#FFE66D')('  Allow? ') +
      chalk.gray('[') +
      chalk.green('y') +
      chalk.gray('/') +
      chalk.red('n') +
      chalk.gray('/') +
      chalk.hex('#4ECDC4')('a') +
      chalk.gray('lways] ')
    );
    const normalized = answer.toLowerCase().trim();
    return normalized === 'y' || normalized === 'yes' || normalized === 'a' || normalized === 'always';
  }

  /**
   * Show a spinner for long operations
   */
  startSpinner(text: string): void {
    if (this.spinner) {
      this.spinner.stop();
    }
    this.spinner = ora({
      text: chalk.hex('#4ECDC4')(text),
      spinner: 'dots12',
      color: 'cyan',
    }).start();
  }

  /**
   * Stop the spinner
   */
  stopSpinner(success: boolean = true, text?: string): void {
    if (this.spinner) {
      if (success) {
        this.spinner.succeed(text ? chalk.green(text) : undefined);
      } else {
        this.spinner.fail(text ? chalk.red(text) : undefined);
      }
      this.spinner = null;
    }
  }

  /**
   * Stream output character by character
   */
  async streamOutput(stream: AsyncIterable<string>): Promise<void> {
    for await (const chunk of stream) {
      process.stdout.write(chunk);
    }
    console.log(); // End with newline
  }

  /**
   * Print assistant message with formatting
   */
  printAssistant(content: string): void {
    console.log();
    console.log(chalk.hex('#4ECDC4')('  ┌─') + chalk.hex('#4ECDC4').bold(' Claude ') + chalk.hex('#4ECDC4')('─────────────────────────────────────────────────────┐'));
    console.log(chalk.hex('#4ECDC4')('  │'));

    // Format content with proper indentation
    const lines = content.split('\n');
    for (const line of lines) {
      console.log(chalk.hex('#4ECDC4')('  │  ') + this.formatLine(line));
    }

    console.log(chalk.hex('#4ECDC4')('  │'));
    console.log(chalk.hex('#4ECDC4')('  └──────────────────────────────────────────────────────────────┘'));
    console.log();
  }

  /**
   * Print tool call information
   */
  printToolCall(toolName: string, params: Record<string, unknown>): void {
    console.log();
    console.log(
      chalk.hex('#FF6B6B')('  ⚡ ') +
      chalk.hex('#FF6B6B').bold('Tool: ') +
      chalk.white(toolName)
    );

    // Pretty print parameters
    for (const [key, value] of Object.entries(params)) {
      const valueStr = typeof value === 'string' ? value : JSON.stringify(value);
      const displayValue = valueStr.length > 60 ? valueStr.slice(0, 57) + '...' : valueStr;
      console.log(chalk.gray('     ') + chalk.hex('#888')(key + ': ') + chalk.white(displayValue));
    }
  }

  /**
   * Print tool result
   */
  printToolResult(success: boolean, output?: string, error?: string): void {
    if (success) {
      console.log(chalk.green('     ✓ Success'));
      if (output && this.config.verbosity === 'verbose') {
        const lines = output.split('\n').slice(0, 10);
        for (const line of lines) {
          console.log(chalk.gray('       ') + chalk.hex('#666')(line.slice(0, 80)));
        }
        if (output.split('\n').length > 10) {
          console.log(chalk.gray('       ... (truncated)'));
        }
      }
    } else {
      console.log(chalk.red('     ✗ Failed'));
      if (error) {
        console.log(chalk.red('       ' + error));
      }
    }
  }

  /**
   * Print error message
   */
  printError(message: string): void {
    console.log();
    console.log(chalk.red('  ┌─') + chalk.red.bold(' Error ') + chalk.red('──────────────────────────────────────────────────────┐'));
    console.log(chalk.red('  │'));
    console.log(chalk.red('  │  ') + chalk.white(message));
    console.log(chalk.red('  │'));
    console.log(chalk.red('  └──────────────────────────────────────────────────────────────┘'));
    console.log();
  }

  /**
   * Print info message
   */
  printInfo(message: string): void {
    console.log(chalk.hex('#4ECDC4')('  ℹ ') + chalk.gray(message));
  }

  /**
   * Print success message
   */
  printSuccess(message: string): void {
    console.log(chalk.green('  ✓ ') + chalk.white(message));
  }

  /**
   * Print warning message
   */
  printWarning(message: string): void {
    console.log(chalk.hex('#FFE66D')('  ⚠ ') + chalk.white(message));
  }

  /**
   * Format a line with syntax highlighting for code
   */
  private formatLine(line: string): string {
    // Check for code block markers
    if (line.startsWith('```')) {
      return chalk.hex('#666')(line);
    }

    // Simple inline code highlighting
    const codeRegex = /`([^`]+)`/g;
    return line.replace(codeRegex, (_match, code: string) => chalk.hex('#FF6B6B')(code));
  }

  /**
   * Show help
   */
  showHelp(): void {
    console.log();
    console.log(chalk.hex('#4ECDC4').bold('  Available Commands:'));
    console.log();
    console.log(chalk.hex('#FF6B6B')('    /help      ') + chalk.gray('Show this help message'));
    console.log(chalk.hex('#FF6B6B')('    /clear     ') + chalk.gray('Clear conversation history'));
    console.log(chalk.hex('#FF6B6B')('    /session   ') + chalk.gray('Show current session information'));
    console.log(chalk.hex('#FF6B6B')('    /sessions  ') + chalk.gray('List all saved sessions'));
    console.log(chalk.hex('#FF6B6B')('    /tools     ') + chalk.gray('List available tools'));
    console.log(chalk.hex('#FF6B6B')('    /exit      ') + chalk.gray('Exit evylcode'));
    console.log();
    console.log(chalk.hex('#4ECDC4').bold('  Example Prompts:'));
    console.log();
    console.log(chalk.gray('    "Read the file src/index.ts"'));
    console.log(chalk.gray('    "Find all TypeScript files in src/"'));
    console.log(chalk.gray('    "Edit the function foo to add error handling"'));
    console.log(chalk.gray('    "Run npm test and fix any failing tests"'));
    console.log();
  }

  /**
   * Show available tools
   */
  showTools(tools: { name: string; description: string }[]): void {
    console.log();
    console.log(chalk.hex('#4ECDC4').bold('  Available Tools:'));
    console.log();
    for (const tool of tools) {
      console.log(
        chalk.hex('#FF6B6B')('    ' + tool.name.padEnd(12)) +
        chalk.gray(tool.description)
      );
    }
    console.log();
  }

  /**
   * Show goodbye message
   */
  showGoodbye(): void {
    console.log();
    console.log(chalk.hex('#4ECDC4')('  ') + chalk.hex('#4ECDC4')('Until next time! Happy coding!'));
    console.log();
  }

  /**
   * Close the interface
   */
  close(): void {
    this.rl.close();
  }
}
