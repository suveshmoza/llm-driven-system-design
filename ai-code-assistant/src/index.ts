#!/usr/bin/env node
/**
 * evylcode CLI - AI-Powered Coding Assistant
 *
 * A terminal-based AI coding assistant with tool use and agentic loop,
 * powered by Claude from Anthropic.
 */

import { Command } from 'commander';
import * as path from 'path';
import chalk from 'chalk';
import { CLIInterface } from './cli/index.js';
import { AgentController } from './agent/index.js';
import { ToolRegistry } from './tools/index.js';
import { MockLLMProvider, AnthropicProvider } from './llm/index.js';
import { PermissionManager } from './permissions/index.js';
import { SessionManager } from './session/index.js';
import type { LLMProvider } from './types/index.js';

const VERSION = '1.0.0';

async function main(): Promise<void> {
  const program = new Command();

  program
    .name('evylcode')
    .description('evylcode CLI - AI-powered command-line coding assistant')
    .version(VERSION)
    .option('-d, --directory <path>', 'Working directory', process.cwd())
    .option('-k, --api-key <key>', 'Anthropic API key (or set ANTHROPIC_API_KEY env var)')
    .option('-m, --model <model>', 'Claude model to use', 'claude-sonnet-4-20250514')
    .option('-r, --resume <sessionId>', 'Resume a previous session')
    .option('-v, --verbose', 'Verbose output')
    .option('--demo', 'Run in demo mode with mock LLM (no API key needed)')
    .option('--list-sessions', 'List all saved sessions')
    .argument('[prompt]', 'Initial prompt to send to the assistant')
    .action(async (prompt, options) => {
      await runAssistant(prompt, options);
    });

  program.parse();
}

interface CLIOptions {
  directory: string;
  apiKey?: string;
  model?: string;
  resume?: string;
  verbose?: boolean;
  demo?: boolean;
  listSessions?: boolean;
}

async function runAssistant(initialPrompt: string | undefined, options: CLIOptions): Promise<void> {
  // Initialize CLI interface
  const cli = new CLIInterface({
    verbosity: options.verbose ? 'verbose' : 'normal',
  });

  const sessionManager = new SessionManager();

  // Handle list sessions
  if (options.listSessions) {
    const sessions = await sessionManager.list();
    if (sessions.length === 0) {
      console.log(chalk.gray('  No saved sessions found.'));
    } else {
      console.log();
      console.log(chalk.hex('#4ECDC4').bold('  Saved Sessions:'));
      console.log();
      for (const session of sessions) {
        console.log(
          chalk.hex('#FF6B6B')(`    ${session.id.slice(0, 8)}`) +
          chalk.gray('  ') +
          chalk.white(session.workingDirectory) +
          chalk.gray(` (${session.messageCount} messages)`)
        );
        console.log(
          chalk.gray(`             Started: ${new Date(session.startedAt).toLocaleString()}`)
        );
        console.log();
      }
    }
    return;
  }

  // Resolve working directory
  const workingDirectory = path.resolve(options.directory);

  // Get API key from options or environment
  const apiKey = options.apiKey || process.env.ANTHROPIC_API_KEY;

  // Determine LLM provider
  let llm: LLMProvider;

  if (options.demo) {
    llm = new MockLLMProvider();
  } else if (!apiKey) {
    // No API key - show helpful message
    console.log();
    console.log(chalk.hex('#FFE66D')('  ⚠  No Anthropic API key provided'));
    console.log();
    console.log(chalk.gray('  To use evylcode with Claude, set your API key:'));
    console.log();
    console.log(chalk.white('    Option 1: ') + chalk.gray('Set environment variable'));
    console.log(chalk.hex('#4ECDC4')('      export ANTHROPIC_API_KEY=your-api-key'));
    console.log();
    console.log(chalk.white('    Option 2: ') + chalk.gray('Pass as command line argument'));
    console.log(chalk.hex('#4ECDC4')('      evylcode --api-key your-api-key'));
    console.log();
    console.log(chalk.white('    Option 3: ') + chalk.gray('Run in demo mode (mock LLM)'));
    console.log(chalk.hex('#4ECDC4')('      evylcode --demo'));
    console.log();
    console.log(chalk.gray('  Get your API key at: ') + chalk.hex('#4ECDC4')('https://console.anthropic.com/'));
    console.log();
    cli.close();
    return;
  } else {
    // Create Anthropic provider with API key
    llm = new AnthropicProvider({
      apiKey,
      model: options.model,
    });
  }

  // Initialize or resume session
  if (options.resume) {
    const resumed = await sessionManager.resume(options.resume);
    if (!resumed) {
      cli.printError(`Session not found: ${options.resume}`);
      cli.close();
      return;
    }
    cli.printInfo(`Resumed session: ${options.resume}`);
  } else {
    await sessionManager.create(workingDirectory);
  }

  // Initialize permission manager
  const permissions = new PermissionManager(workingDirectory, cli);

  // Grant default read permissions for working directory
  permissions.grantPermission('read', `${workingDirectory}/**/*`, 'session');

  // Initialize tool registry
  const tools = new ToolRegistry();

  // Initialize agent controller
  const agent = new AgentController(
    llm,
    tools,
    permissions,
    sessionManager,
    cli,
    workingDirectory
  );

  // Show welcome banner
  cli.showWelcome();
  cli.showGreeting();
  cli.printInfo(`Working directory: ${workingDirectory}`);

  if (options.demo) {
    cli.printWarning('Running in demo mode with mock LLM');
  } else {
    cli.printInfo(`Model: ${options.model || 'claude-sonnet-4-20250514'}`);
  }
  console.log();

  // Handle initial prompt if provided
  if (initialPrompt) {
    await agent.run(initialPrompt);
  }

  // Main interaction loop
  await runInteractionLoop(cli, agent, sessionManager, tools);
}

async function runInteractionLoop(
  cli: CLIInterface,
  agent: AgentController,
  sessionManager: SessionManager,
  tools: ToolRegistry
): Promise<void> {
  while (true) {
    try {
      const input = await cli.prompt();
      const trimmed = input.trim();

      if (!trimmed) {
        continue;
      }

      // Handle slash commands
      if (trimmed.startsWith('/')) {
        const command = trimmed.toLowerCase();

        switch (command) {
          case '/exit':
          case '/quit':
          case '/q':
            cli.showGoodbye();
            await sessionManager.saveCurrent();
            cli.close();
            return;

          case '/help':
          case '/h':
          case '/?':
            cli.showHelp();
            break;

          case '/clear':
            agent.clearHistory();
            cli.printSuccess('Conversation history cleared');
            break;

          case '/session':
            console.log();
            console.log(sessionManager.getSessionInfo());
            console.log();
            break;

          case '/sessions':
            const sessions = await sessionManager.list();
            if (sessions.length === 0) {
              cli.printInfo('No saved sessions');
            } else {
              console.log();
              console.log(chalk.hex('#4ECDC4').bold('  Saved Sessions:'));
              console.log();
              for (const s of sessions.slice(0, 10)) {
                console.log(
                  chalk.hex('#FF6B6B')(`    ${s.id.slice(0, 8)}`) +
                  chalk.gray(`  ${s.messageCount} messages  ${new Date(s.startedAt).toLocaleDateString()}`)
                );
              }
              console.log();
            }
            break;

          case '/tools':
            const toolList = tools.getAll().map(t => ({
              name: t.name,
              description: t.description,
            }));
            cli.showTools(toolList);
            break;

          default:
            cli.printError(`Unknown command: ${command}. Type /help for available commands.`);
        }
      } else {
        // Regular input - send to agent
        await agent.run(trimmed);
      }
    } catch (error) {
      if (error instanceof Error && error.message.includes('readline was closed')) {
        // User pressed Ctrl+C or closed input
        break;
      }
      cli.printError(error instanceof Error ? error.message : String(error));
    }
  }
}

// Handle uncaught errors
process.on('uncaughtException', (error) => {
  console.error(chalk.red('\n  Uncaught exception:'), error.message);
  process.exit(1);
});

process.on('unhandledRejection', (reason) => {
  console.error(chalk.red('\n  Unhandled rejection:'), reason);
  process.exit(1);
});

// Handle Ctrl+C gracefully
process.on('SIGINT', () => {
  console.log();
  console.log(chalk.hex('#4ECDC4')('\n  Until next time! Happy coding!\n'));
  process.exit(0);
});

// Run main
main().catch((error) => {
  console.error(chalk.red('\n  Fatal error:'), error.message);
  process.exit(1);
});
