/**
 * Permission Manager - Safety layer for controlling access to operations.
 *
 * This module provides a crucial security layer that controls what the AI
 * assistant can do. It implements a tiered permission system that:
 * - Auto-approves safe operations (file reads)
 * - Requires user confirmation for potentially destructive operations
 * - Blocks dangerous operations entirely (rm -rf /, accessing credentials)
 *
 * @module permissions/manager
 */

import { minimatch } from 'minimatch';
import type { Permission, PermissionRequest, PermissionSet, PermissionType, PermissionScope } from '../types/index.js';
import type { CLIInterface } from '../cli/interface.js';

/**
 * Glob patterns for paths that are always blocked from access.
 * These protect sensitive files like SSH keys, credentials, and secrets.
 */
const BLOCKED_PATHS = [
  '**/.ssh/**',
  '**/.gnupg/**',
  '**/credentials*',
  '**/secrets*',
  '**/.env',
  '**/.env.*',
  '**/id_rsa*',
  '**/id_ed25519*',
  '**/id_dsa*',
  '**/*.pem',
  '**/*.key',
];

/**
 * Regex patterns for commands that are always blocked.
 * These prevent system-damaging operations like recursive deletes,
 * privilege escalation, and filesystem formatting.
 */
const BLOCKED_COMMANDS = [
  /rm\s+-rf?\s+[\/~]/,
  /mkfs/,
  /dd\s+if=/,
  /:(){:|:&};:/,
  /sudo\s+rm/,
  />\s*\/dev\/sd/,
];

/**
 * Manages permissions for tool operations.
 *
 * The PermissionManager implements the PermissionSet interface and provides:
 * - Permission checking (canRead, canWrite, canExecute)
 * - Interactive permission requests via CLI
 * - Grant tracking with session scope
 * - Blocked pattern enforcement for dangerous operations
 *
 * Permission flow:
 * 1. Tool requests operation
 * 2. Manager checks if operation is blocked (always denied)
 * 3. Manager checks if there's an existing grant
 * 4. If no grant, prompts user via CLI
 * 5. Stores grant if approved for session reuse
 */
export class PermissionManager implements PermissionSet {
  /** Active permission grants */
  grants: Permission[] = [];
  /** Set of denied requests to avoid re-prompting */
  private denials: Set<string> = new Set();
  /** Current working directory for path resolution */
  private workingDirectory: string;
  /** CLI interface for user prompts */
  private cli: CLIInterface;

  /**
   * Creates a new PermissionManager.
   * @param workingDirectory - Base directory for relative path checking
   * @param cli - CLI interface for user interaction
   */
  constructor(workingDirectory: string, cli: CLIInterface) {
    this.workingDirectory = workingDirectory;
    this.cli = cli;
  }

  /**
   * Check if reading a path is allowed.
   * Reads are generally allowed unless the path matches a blocked pattern.
   * @param path - The file or directory path to check
   * @returns True if reading is permitted
   */
  canRead(path: string): boolean {
    // Check blocked paths
    if (this.isBlockedPath(path)) {
      return false;
    }

    // Reads are generally allowed by default
    return true;
  }

  /**
   * Check if writing to a path is allowed.
   * Requires either a matching grant or paths within the working directory.
   * @param path - The file path to check
   * @returns True if writing is permitted
   */
  canWrite(path: string): boolean {
    // Check blocked paths
    if (this.isBlockedPath(path)) {
      return false;
    }

    // Check if we have a grant for this path
    return this.hasGrant('write', path);
  }

  /**
   * Check if executing a command is allowed.
   * Blocked commands are always denied, others require a grant.
   * @param command - The shell command to check
   * @returns True if execution is permitted
   */
  canExecute(command: string): boolean {
    // Check blocked commands
    if (this.isBlockedCommand(command)) {
      return false;
    }

    // Check if we have a grant for this command
    return this.hasGrant('execute', command);
  }

  /**
   * Request permission for an operation interactively.
   * Prompts the user via CLI if no existing grant covers the operation.
   * @param request - The permission request with tool, operation, and details
   * @returns True if permission was granted, false if denied
   */
  async requestPermission(request: PermissionRequest): Promise<boolean> {
    const key = this.requestKey(request);

    // Check if already granted
    if (this.hasGrantForRequest(request)) {
      return true;
    }

    // Check if already denied in this session
    if (this.denials.has(key)) {
      return false;
    }

    // Format the permission request message
    const description = this.formatRequest(request);

    // Ask user
    const approved = await this.cli.confirm(description);

    if (approved) {
      // Create a grant
      const grant = this.createGrant(request);
      this.grants.push(grant);
    } else {
      this.denials.add(key);
    }

    return approved;
  }

  /**
   * Grant a permission programmatically without user interaction.
   * Used for auto-approved operations or pre-configured permissions.
   * @param type - Type of permission to grant
   * @param pattern - Path glob or command prefix the grant applies to
   * @param scope - How long the permission lasts (defaults to 'session')
   */
  grantPermission(type: PermissionType, pattern: string, scope: PermissionScope = 'session'): void {
    this.grants.push({
      type,
      pattern,
      scope,
      grantedAt: new Date(),
    });
  }

  /**
   * Check if a path matches any blocked pattern.
   * @param path - The path to check
   * @returns True if the path is blocked
   */
  private isBlockedPath(path: string): boolean {
    return BLOCKED_PATHS.some(pattern => minimatch(path, pattern));
  }

  /**
   * Check if a command matches any blocked pattern.
   * @param command - The command to check
   * @returns True if the command is blocked
   */
  private isBlockedCommand(command: string): boolean {
    return BLOCKED_COMMANDS.some(pattern => pattern.test(command));
  }

  /**
   * Check if there's an existing grant for a specific type and target.
   * @param type - The permission type
   * @param target - The path or command to check
   * @returns True if a matching grant exists
   */
  private hasGrant(type: PermissionType, target: string): boolean {
    return this.grants.some(grant => {
      if (grant.type !== type) return false;

      if (type === 'execute') {
        // For commands, match by prefix
        return target.startsWith(grant.pattern) || grant.pattern === '*';
      } else {
        // For paths, use glob matching
        return minimatch(target, grant.pattern) || target.startsWith(this.workingDirectory);
      }
    });
  }

  /**
   * Check if there's a grant that covers a permission request.
   * @param request - The permission request to check
   * @returns True if the request is already covered by a grant
   */
  private hasGrantForRequest(request: PermissionRequest): boolean {
    const type = this.getRequestType(request);
    return this.hasGrant(type, request.details);
  }

  /**
   * Determine the permission type for a request based on the tool name.
   * @param request - The permission request
   * @returns The appropriate permission type
   */
  private getRequestType(request: PermissionRequest): PermissionType {
    switch (request.tool) {
      case 'Read':
      case 'Glob':
      case 'Grep':
        return 'read';
      case 'Write':
      case 'Edit':
        return 'write';
      case 'Bash':
        return 'execute';
      default:
        return 'execute';
    }
  }

  /**
   * Generate a unique key for a permission request.
   * Used for tracking denials to avoid re-prompting.
   * @param request - The permission request
   * @returns A unique string key
   */
  private requestKey(request: PermissionRequest): string {
    return `${request.tool}:${request.operation}:${request.details}`;
  }

  /**
   * Create a permission grant from a request.
   * @param request - The permission request to convert
   * @returns A new Permission object
   */
  private createGrant(request: PermissionRequest): Permission {
    const type = this.getRequestType(request);

    return {
      type,
      pattern: request.details,
      scope: 'session',
      grantedAt: new Date(),
    };
  }

  /**
   * Format a permission request for display to the user.
   * @param request - The permission request to format
   * @returns Formatted string for CLI display
   */
  private formatRequest(request: PermissionRequest): string {
    return `${request.tool}: ${request.operation}\n│     Target: ${request.details}`;
  }

  /**
   * Get a copy of all active grants.
   * @returns Array of permission grants
   */
  getGrants(): Permission[] {
    return [...this.grants];
  }

  /**
   * Clear all session-scoped grants and denials.
   * Called when starting a new session or clearing history.
   */
  clearSessionGrants(): void {
    this.grants = this.grants.filter(g => g.scope === 'permanent');
    this.denials.clear();
  }
}
