/**
 * Command Parser Module
 *
 * Parses user input into structured commands for execution.
 * Provides a uniform interface for handling input from both TCP and HTTP clients.
 * Commands start with "/" (e.g., /join, /nick); everything else is a message.
 */

import type { ParsedCommand, CommandType } from '../types/index.js';

/**
 * Mapping of command names to their canonical types.
 * Only commands in this map are recognized as valid slash commands.
 */
const COMMANDS: Record<string, CommandType> = {
  help: 'help',
  nick: 'nick',
  list: 'list',
  quit: 'quit',
  create: 'create',
  join: 'join',
  rooms: 'rooms',
  leave: 'leave',
  dm: 'dm',
};

/**
 * Parses user input into structured commands.
 *
 * This class is central to the chat system's command handling:
 * - Normalizes input from different transports (TCP, HTTP)
 * - Distinguishes between commands and regular messages
 * - Provides consistent command structure for the ChatHandler
 */
export class CommandParser {
  /**
   * Parse a raw input line into a command or message.
   * Commands start with "/" and are looked up in the COMMANDS map.
   * Everything else is treated as a chat message.
   *
   * @param input - Raw input string from the user
   * @returns Parsed command with type, arguments, and raw input
   *
   * @example
   * parser.parse('/join general')  // { type: 'join', args: ['general'], raw: '/join general' }
   * parser.parse('Hello world')    // { type: 'message', args: ['Hello world'], raw: 'Hello world' }
   */
  parse(input: string): ParsedCommand {
    const trimmed = input.trim();

    if (!trimmed) {
      return { type: 'message', args: [], raw: '' };
    }

    // Check if it's a command (starts with /)
    if (trimmed.startsWith('/')) {
      const parts = trimmed.slice(1).split(/\s+/);
      const command = parts[0].toLowerCase();
      const args = parts.slice(1);

      if (command in COMMANDS) {
        return {
          type: COMMANDS[command],
          args,
          raw: trimmed,
        };
      }

      // Unknown command - treat as message but could also return error
      return {
        type: 'message',
        args: [trimmed],
        raw: trimmed,
      };
    }

    // Regular message
    return {
      type: 'message',
      args: [trimmed],
      raw: trimmed,
    };
  }

  /**
   * Get help text for all available commands.
   * Displayed when user types /help.
   *
   * @returns Formatted help text listing all commands and their usage
   */
  getHelpText(): string {
    return `Available commands:
  /help         - Show this message
  /nick <name>  - Change your nickname
  /list         - List users in current room
  /quit         - Disconnect from server
  /create <room>- Create a new room
  /join <room>  - Join an existing room
  /rooms        - List all available rooms
  /leave        - Leave current room
  /dm <user> <message> - Send direct message`;
  }
}

/** Singleton instance of the command parser */
export const commandParser = new CommandParser();
export default commandParser;
