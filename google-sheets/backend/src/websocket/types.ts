/**
 * Shared types and interfaces for WebSocket collaboration.
 *
 * @module websocket/types
 */

import { WebSocket } from 'ws';

/**
 * Extended WebSocket interface with user and session properties.
 * Tracks user identity and spreadsheet association for each connection.
 */
export interface ExtendedWebSocket extends WebSocket {
  userId?: string;
  sessionId?: string;
  spreadsheetId?: string;
  userName?: string;
  userColor?: string;
  isAlive?: boolean;
}

/**
 * Represents a collaborative editing room for a single spreadsheet.
 * Multiple users can join the same room to edit together.
 */
export interface Room {
  clients: Set<ExtendedWebSocket>;
}

/**
 * Cell data structure for storage and transmission.
 */
export interface CellData {
  rawValue: string;
  computedValue: string;
  format?: any;
}

/**
 * Collaborator presence information.
 */
export interface Collaborator {
  userId?: string;
  name?: string;
  color?: string;
}

/**
 * Cell edit payload from client.
 */
export interface CellEditPayload {
  sheetId: string;
  row: number;
  col: number;
  value: string;
  requestId?: string;
}

/**
 * Cursor move payload from client.
 */
export interface CursorMovePayload {
  row: number;
  col: number;
}

/**
 * Selection change payload from client.
 */
export interface SelectionChangePayload {
  range: {
    startRow: number;
    startCol: number;
    endRow: number;
    endCol: number;
  };
}

/**
 * Column resize payload from client.
 */
export interface ResizeColumnPayload {
  sheetId: string;
  col: number;
  width: number;
}

/**
 * Row resize payload from client.
 */
export interface ResizeRowPayload {
  sheetId: string;
  row: number;
  height: number;
}

/**
 * Sheet rename payload from client.
 */
export interface RenameSheetPayload {
  sheetId: string;
  name: string;
}

/**
 * Predefined color palette for collaborator presence indicators.
 * Colors cycle through the array as new users join.
 */
export const COLORS = [
  '#FF6B6B', '#4ECDC4', '#45B7D1', '#96CEB4',
  '#FFEAA7', '#DDA0DD', '#98D8C8', '#F7DC6F',
  '#74B9FF', '#A29BFE', '#FD79A8', '#00B894'
];
