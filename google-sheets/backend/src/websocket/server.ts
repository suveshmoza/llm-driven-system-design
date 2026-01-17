import { WebSocketServer, WebSocket } from 'ws';
import { IncomingMessage } from 'http';
import { pool } from '../shared/db.js';
import { publishToSpreadsheet } from '../shared/redis.js';
import { v4 as uuidv4 } from 'uuid';

interface ExtendedWebSocket extends WebSocket {
  userId?: string;
  sessionId?: string;
  spreadsheetId?: string;
  userName?: string;
  userColor?: string;
  isAlive?: boolean;
}

interface Room {
  clients: Set<ExtendedWebSocket>;
}

// Rooms by spreadsheet ID
const rooms = new Map<string, Room>();

// User colors for presence
const COLORS = [
  '#FF6B6B', '#4ECDC4', '#45B7D1', '#96CEB4',
  '#FFEAA7', '#DDA0DD', '#98D8C8', '#F7DC6F',
  '#74B9FF', '#A29BFE', '#FD79A8', '#00B894'
];

let colorIndex = 0;
function getNextColor(): string {
  const color = COLORS[colorIndex % COLORS.length];
  colorIndex++;
  return color;
}

export function setupWebSocket(server: any) {
  const wss = new WebSocketServer({ server, path: '/ws' });

  // Heartbeat to detect stale connections
  const interval = setInterval(() => {
    wss.clients.forEach((ws) => {
      const extWs = ws as ExtendedWebSocket;
      if (extWs.isAlive === false) {
        handleDisconnect(extWs);
        return extWs.terminate();
      }
      extWs.isAlive = false;
      extWs.ping();
    });
  }, 30000);

  wss.on('close', () => {
    clearInterval(interval);
  });

  wss.on('connection', async (ws: ExtendedWebSocket, req: IncomingMessage) => {
    ws.isAlive = true;
    ws.on('pong', () => { ws.isAlive = true; });

    // Parse query params
    const url = new URL(req.url || '', `http://${req.headers.host}`);
    const spreadsheetId = url.searchParams.get('spreadsheetId');
    const sessionId = url.searchParams.get('sessionId');
    const userName = url.searchParams.get('name') || 'Anonymous';

    if (!spreadsheetId) {
      ws.close(4000, 'Missing spreadsheetId');
      return;
    }

    // Assign user identity
    ws.spreadsheetId = spreadsheetId;
    ws.sessionId = sessionId || uuidv4();
    ws.userId = uuidv4();
    ws.userName = userName;
    ws.userColor = getNextColor();

    // Join room
    if (!rooms.has(spreadsheetId)) {
      rooms.set(spreadsheetId, { clients: new Set() });
    }
    const room = rooms.get(spreadsheetId)!;
    room.clients.add(ws);

    console.log(`User ${ws.userName} joined spreadsheet ${spreadsheetId}`);

    // Send current state to new client
    await sendInitialState(ws, spreadsheetId);

    // Broadcast user joined
    broadcastToRoom(spreadsheetId, {
      type: 'USER_JOINED',
      userId: ws.userId,
      name: ws.userName,
      color: ws.userColor,
    }, ws);

    // Handle messages
    ws.on('message', async (data) => {
      try {
        const message = JSON.parse(data.toString());
        await handleMessage(ws, message);
      } catch (e) {
        console.error('Error handling message:', e);
        ws.send(JSON.stringify({ type: 'ERROR', message: 'Invalid message format' }));
      }
    });

    ws.on('close', () => {
      handleDisconnect(ws);
    });

    ws.on('error', (error) => {
      console.error('WebSocket error:', error);
      handleDisconnect(ws);
    });
  });

  return wss;
}

async function sendInitialState(ws: ExtendedWebSocket, spreadsheetId: string) {
  try {
    // Get spreadsheet info
    const spreadsheetResult = await pool.query(
      'SELECT * FROM spreadsheets WHERE id = $1',
      [spreadsheetId]
    );

    if (spreadsheetResult.rows.length === 0) {
      // Create new spreadsheet if doesn't exist
      await pool.query(
        'INSERT INTO spreadsheets (id, title) VALUES ($1, $2)',
        [spreadsheetId, 'Untitled Spreadsheet']
      );
      await pool.query(
        'INSERT INTO sheets (spreadsheet_id, name, sheet_index) VALUES ($1, $2, 0)',
        [spreadsheetId, 'Sheet1']
      );
    }

    // Get sheets
    const sheetsResult = await pool.query(
      'SELECT * FROM sheets WHERE spreadsheet_id = $1 ORDER BY sheet_index',
      [spreadsheetId]
    );

    // Get cells for first sheet
    const cells: Record<string, any> = {};
    if (sheetsResult.rows.length > 0) {
      const sheetId = sheetsResult.rows[0].id;
      const cellsResult = await pool.query(
        'SELECT row_index, col_index, raw_value, computed_value, format FROM cells WHERE sheet_id = $1',
        [sheetId]
      );

      for (const cell of cellsResult.rows) {
        const key = `${cell.row_index}-${cell.col_index}`;
        cells[key] = {
          rawValue: cell.raw_value,
          computedValue: cell.computed_value,
          format: cell.format,
        };
      }
    }

    // Get column widths
    const columnWidths: Record<number, number> = {};
    if (sheetsResult.rows.length > 0) {
      const widthsResult = await pool.query(
        'SELECT col_index, width FROM column_widths WHERE sheet_id = $1',
        [sheetsResult.rows[0].id]
      );
      for (const row of widthsResult.rows) {
        columnWidths[row.col_index] = row.width;
      }
    }

    // Get row heights
    const rowHeights: Record<number, number> = {};
    if (sheetsResult.rows.length > 0) {
      const heightsResult = await pool.query(
        'SELECT row_index, height FROM row_heights WHERE sheet_id = $1',
        [sheetsResult.rows[0].id]
      );
      for (const row of heightsResult.rows) {
        rowHeights[row.row_index] = row.height;
      }
    }

    // Get current collaborators
    const collaborators: any[] = [];
    const room = rooms.get(spreadsheetId);
    if (room) {
      for (const client of room.clients) {
        if (client !== ws && client.userId) {
          collaborators.push({
            userId: client.userId,
            name: client.userName,
            color: client.userColor,
          });
        }
      }
    }

    ws.send(JSON.stringify({
      type: 'STATE_SYNC',
      spreadsheet: spreadsheetResult.rows[0] || { id: spreadsheetId, title: 'Untitled Spreadsheet' },
      sheets: sheetsResult.rows,
      activeSheetId: sheetsResult.rows[0]?.id,
      cells,
      columnWidths,
      rowHeights,
      collaborators,
      user: {
        userId: ws.userId,
        name: ws.userName,
        color: ws.userColor,
      },
    }));
  } catch (error) {
    console.error('Error sending initial state:', error);
    ws.send(JSON.stringify({ type: 'ERROR', message: 'Failed to load spreadsheet' }));
  }
}

async function handleMessage(ws: ExtendedWebSocket, message: any) {
  const { type, ...payload } = message;

  switch (type) {
    case 'CELL_EDIT':
      await handleCellEdit(ws, payload);
      break;

    case 'CURSOR_MOVE':
      handleCursorMove(ws, payload);
      break;

    case 'SELECTION_CHANGE':
      handleSelectionChange(ws, payload);
      break;

    case 'RESIZE_COLUMN':
      await handleResizeColumn(ws, payload);
      break;

    case 'RESIZE_ROW':
      await handleResizeRow(ws, payload);
      break;

    case 'RENAME_SHEET':
      await handleRenameSheet(ws, payload);
      break;

    default:
      console.log('Unknown message type:', type);
  }
}

async function handleCellEdit(ws: ExtendedWebSocket, payload: any) {
  const { sheetId, row, col, value } = payload;

  try {
    // Compute value (in production, use HyperFormula)
    let computedValue = value;
    if (value && value.startsWith('=')) {
      // Simple formula evaluation for demo
      computedValue = evaluateFormula(value);
    }

    // Upsert cell
    await pool.query(`
      INSERT INTO cells (sheet_id, row_index, col_index, raw_value, computed_value)
      VALUES ($1, $2, $3, $4, $5)
      ON CONFLICT (sheet_id, row_index, col_index)
      DO UPDATE SET raw_value = $4, computed_value = $5, updated_at = NOW()
    `, [sheetId, row, col, value, computedValue]);

    // Broadcast to all clients in room
    broadcastToRoom(ws.spreadsheetId!, {
      type: 'CELL_UPDATED',
      sheetId,
      row,
      col,
      rawValue: value,
      computedValue,
      userId: ws.userId,
    });

    // Also publish to Redis for multi-server support
    publishToSpreadsheet(ws.spreadsheetId!, {
      type: 'CELL_UPDATED',
      sheetId,
      row,
      col,
      rawValue: value,
      computedValue,
      userId: ws.userId,
    });
  } catch (error) {
    console.error('Error handling cell edit:', error);
    ws.send(JSON.stringify({ type: 'ERROR', message: 'Failed to save cell' }));
  }
}

function handleCursorMove(ws: ExtendedWebSocket, payload: any) {
  const { row, col } = payload;

  broadcastToRoom(ws.spreadsheetId!, {
    type: 'CURSOR_MOVED',
    userId: ws.userId,
    name: ws.userName,
    color: ws.userColor,
    row,
    col,
  }, ws);
}

function handleSelectionChange(ws: ExtendedWebSocket, payload: any) {
  const { range } = payload;

  broadcastToRoom(ws.spreadsheetId!, {
    type: 'SELECTION_CHANGED',
    userId: ws.userId,
    name: ws.userName,
    color: ws.userColor,
    range,
  }, ws);
}

async function handleResizeColumn(ws: ExtendedWebSocket, payload: any) {
  const { sheetId, col, width } = payload;

  try {
    await pool.query(`
      INSERT INTO column_widths (sheet_id, col_index, width)
      VALUES ($1, $2, $3)
      ON CONFLICT (sheet_id, col_index)
      DO UPDATE SET width = $3
    `, [sheetId, col, width]);

    broadcastToRoom(ws.spreadsheetId!, {
      type: 'COLUMN_RESIZED',
      sheetId,
      col,
      width,
      userId: ws.userId,
    });
  } catch (error) {
    console.error('Error resizing column:', error);
  }
}

async function handleResizeRow(ws: ExtendedWebSocket, payload: any) {
  const { sheetId, row, height } = payload;

  try {
    await pool.query(`
      INSERT INTO row_heights (sheet_id, row_index, height)
      VALUES ($1, $2, $3)
      ON CONFLICT (sheet_id, row_index)
      DO UPDATE SET height = $3
    `, [sheetId, row, height]);

    broadcastToRoom(ws.spreadsheetId!, {
      type: 'ROW_RESIZED',
      sheetId,
      row,
      height,
      userId: ws.userId,
    });
  } catch (error) {
    console.error('Error resizing row:', error);
  }
}

async function handleRenameSheet(ws: ExtendedWebSocket, payload: any) {
  const { sheetId, name } = payload;

  try {
    await pool.query('UPDATE sheets SET name = $1 WHERE id = $2', [name, sheetId]);

    broadcastToRoom(ws.spreadsheetId!, {
      type: 'SHEET_RENAMED',
      sheetId,
      name,
      userId: ws.userId,
    });
  } catch (error) {
    console.error('Error renaming sheet:', error);
  }
}

function handleDisconnect(ws: ExtendedWebSocket) {
  if (!ws.spreadsheetId) return;

  const room = rooms.get(ws.spreadsheetId);
  if (room) {
    room.clients.delete(ws);

    if (room.clients.size === 0) {
      rooms.delete(ws.spreadsheetId);
    } else {
      // Broadcast user left
      broadcastToRoom(ws.spreadsheetId, {
        type: 'USER_LEFT',
        userId: ws.userId,
      });
    }
  }

  console.log(`User ${ws.userName} left spreadsheet ${ws.spreadsheetId}`);
}

function broadcastToRoom(spreadsheetId: string, message: any, exclude?: ExtendedWebSocket) {
  const room = rooms.get(spreadsheetId);
  if (!room) return;

  const data = JSON.stringify(message);
  for (const client of room.clients) {
    if (client !== exclude && client.readyState === WebSocket.OPEN) {
      client.send(data);
    }
  }
}

// Simple formula evaluator (demo only - use HyperFormula in production)
function evaluateFormula(formula: string): string {
  try {
    // Remove the = prefix
    const expr = formula.slice(1).toUpperCase();

    // Handle simple SUM, e.g., =SUM(1,2,3)
    if (expr.startsWith('SUM(')) {
      const inner = expr.slice(4, -1);
      const nums = inner.split(',').map(n => parseFloat(n.trim())).filter(n => !isNaN(n));
      return nums.reduce((a, b) => a + b, 0).toString();
    }

    // Handle simple arithmetic
    const result = Function(`"use strict"; return (${formula.slice(1)})`)();
    return String(result);
  } catch {
    return '#ERROR';
  }
}
