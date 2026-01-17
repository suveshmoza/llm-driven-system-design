/**
 * Tool Registry - Central tool management.
 *
 * This module provides the ToolRegistry class which manages all available tools
 * in the system. It handles tool registration, lookup, and execution, serving
 * as the central point of coordination between the agent controller and
 * individual tool implementations.
 *
 * @module tools
 */

import type { Tool, ToolDefinition, ToolContext, ToolResult } from '../types/index.js';
import { ReadTool } from './read.js';
import { WriteTool } from './write.js';
import { EditTool } from './edit.js';
import { BashTool } from './bash.js';
import { GlobTool } from './glob.js';
import { GrepTool } from './grep.js';

/**
 * Registry for managing available tools.
 *
 * The ToolRegistry is the central hub for all tool operations:
 * - Registers default tools on initialization
 * - Provides tool lookup by name
 * - Generates tool definitions for the LLM
 * - Handles tool execution with error handling
 * - Determines which tools require user approval
 */
export class ToolRegistry {
  /** Map of tool names to tool implementations */
  private tools: Map<string, Tool> = new Map();

  /**
   * Creates a new ToolRegistry and registers default tools.
   * Default tools include: Read, Write, Edit, Bash, Glob, Grep.
   */
  constructor() {
    // Register default tools
    this.register(ReadTool);
    this.register(WriteTool);
    this.register(EditTool);
    this.register(BashTool);
    this.register(GlobTool);
    this.register(GrepTool);
  }

  /**
   * Register a tool in the registry.
   * @param tool - The tool implementation to register
   */
  register(tool: Tool): void {
    this.tools.set(tool.name, tool);
  }

  /**
   * Get a tool by name.
   * @param name - The name of the tool to retrieve
   * @returns The tool if found, undefined otherwise
   */
  get(name: string): Tool | undefined {
    return this.tools.get(name);
  }

  /**
   * Get all registered tools.
   * @returns Array of all tool implementations
   */
  getAll(): Tool[] {
    return Array.from(this.tools.values());
  }

  /**
   * Get tool definitions formatted for the LLM.
   * This is sent to Claude so it knows what tools are available.
   * @returns Array of tool definitions with name, description, and parameters
   */
  getDefinitions(): ToolDefinition[] {
    return this.getAll().map(tool => ({
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
    }));
  }

  /**
   * Check if a tool requires user approval for given parameters.
   * Some tools (like Bash) have dynamic approval based on the command.
   * @param name - The tool name
   * @param params - The parameters to check
   * @returns True if approval is required, false otherwise
   */
  requiresApproval(name: string, params: Record<string, unknown>): boolean {
    const tool = this.get(name);
    if (!tool) return true; // Unknown tools require approval

    if (typeof tool.requiresApproval === 'function') {
      return tool.requiresApproval(params);
    }
    return tool.requiresApproval;
  }

  /**
   * Execute a tool with error handling.
   * @param name - The name of the tool to execute
   * @param params - Parameters to pass to the tool
   * @param context - Execution context with working directory and permissions
   * @returns The tool execution result
   */
  async execute(name: string, params: Record<string, unknown>, context: ToolContext): Promise<ToolResult> {
    const tool = this.get(name);

    if (!tool) {
      return {
        toolId: name,
        success: false,
        error: `Unknown tool: ${name}`,
      };
    }

    try {
      return await tool.execute(params, context);
    } catch (error) {
      return {
        toolId: name,
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }
}

// Export tools
export { ReadTool } from './read.js';
export { WriteTool } from './write.js';
export { EditTool } from './edit.js';
export { BashTool } from './bash.js';
export { GlobTool } from './glob.js';
export { GrepTool } from './grep.js';
