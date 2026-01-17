import { query, execute } from '../db/postgres.js';
import { v4 as uuidv4 } from 'uuid';
import type { Operation, CanvasData, DesignObject } from '../types/index.js';
import { fileService } from './fileService.js';

/**
 * Database row type for operations table.
 * Maps PostgreSQL columns to TypeScript types.
 */
interface OperationRow {
  id: string;
  file_id: string;
  user_id: string | null;
  operation_type: string;
  object_id: string;
  property_path: string | null;
  old_value: unknown;
  new_value: unknown;
  timestamp: string;
  client_id: string;
  created_at: Date;
}

/**
 * Lamport clock for ordering operations across distributed clients.
 * Ensures causal ordering even with clock skew between clients.
 */
// Simple Lamport clock for ordering
let lamportClock = Date.now();

/**
 * Service for processing CRDT-style operations on design files.
 * Handles operation ordering, conflict resolution, and persistence.
 * Provides the foundation for real-time collaborative editing.
 */
export class OperationService {
  /**
   * Generates the next Lamport timestamp for an operation.
   * Ensures monotonically increasing timestamps.
   * @returns The next timestamp value
   */
  // Generate next timestamp
  getNextTimestamp(): number {
    lamportClock = Math.max(lamportClock + 1, Date.now());
    return lamportClock;
  }

  /**
   * Updates the Lamport clock based on a received timestamp.
   * Ensures the local clock stays ahead of any received timestamp.
   * @param receivedTimestamp - Timestamp from a received operation
   */
  // Update clock based on received timestamp
  updateClock(receivedTimestamp: number): void {
    lamportClock = Math.max(lamportClock, receivedTimestamp) + 1;
  }

  /**
   * Applies an operation to canvas data and returns the new state.
   * Handles create, update, delete, and move operations.
   * Uses Last-Writer-Wins for conflict resolution.
   * @param canvasData - The current canvas state
   * @param operation - The operation to apply
   * @returns The new canvas state after applying the operation
   */
  // Apply operation to canvas data
  applyOperation(canvasData: CanvasData, operation: Operation): CanvasData {
    const newData = { ...canvasData, objects: [...canvasData.objects] };

    switch (operation.operationType) {
      case 'create': {
        const newObject = operation.newValue as DesignObject;
        newData.objects.push(newObject);
        break;
      }
      case 'update': {
        const index = newData.objects.findIndex(o => o.id === operation.objectId);
        if (index !== -1) {
          if (operation.propertyPath) {
            // Update specific property
            const obj = { ...newData.objects[index] };
            this.setNestedProperty(obj, operation.propertyPath, operation.newValue);
            newData.objects[index] = obj;
          } else {
            // Replace entire object
            newData.objects[index] = {
              ...newData.objects[index],
              ...(operation.newValue as Partial<DesignObject>),
            };
          }
        }
        break;
      }
      case 'delete': {
        const index = newData.objects.findIndex(o => o.id === operation.objectId);
        if (index !== -1) {
          newData.objects.splice(index, 1);
        }
        break;
      }
      case 'move': {
        const fromIndex = newData.objects.findIndex(o => o.id === operation.objectId);
        if (fromIndex !== -1 && typeof operation.newValue === 'number') {
          const [obj] = newData.objects.splice(fromIndex, 1);
          newData.objects.splice(operation.newValue as number, 0, obj);
        }
        break;
      }
    }

    return newData;
  }

  /**
   * Sets a nested property on an object using dot notation path.
   * Used for partial property updates in update operations.
   * @param obj - The object to modify
   * @param path - Dot-separated path to the property
   * @param value - The value to set
   */
  // Set nested property using dot notation
  private setNestedProperty(obj: Record<string, unknown>, path: string, value: unknown): void {
    const parts = path.split('.');
    let current: Record<string, unknown> = obj;

    for (let i = 0; i < parts.length - 1; i++) {
      const part = parts[i];
      if (!(part in current)) {
        current[part] = {};
      }
      current = current[part] as Record<string, unknown>;
    }

    current[parts[parts.length - 1]] = value;
  }

  /**
   * Persists an operation to the database for history and replay.
   * @param operation - The operation to store
   */
  // Store operation in database
  async storeOperation(operation: Operation): Promise<void> {
    await execute(
      `INSERT INTO operations (id, file_id, user_id, operation_type, object_id, property_path, old_value, new_value, timestamp, client_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [
        operation.id,
        operation.fileId,
        operation.userId,
        operation.operationType,
        operation.objectId,
        operation.propertyPath || null,
        operation.oldValue ? JSON.stringify(operation.oldValue) : null,
        operation.newValue ? JSON.stringify(operation.newValue) : null,
        operation.timestamp,
        operation.clientId,
      ]
    );
  }

  /**
   * Retrieves operations that occurred after a given timestamp.
   * Used for client synchronization and catching up missed operations.
   * @param fileId - The file to get operations for
   * @param sinceTimestamp - Only return operations after this timestamp
   * @returns Promise resolving to array of operations
   */
  // Get operations since a timestamp
  async getOperationsSince(fileId: string, sinceTimestamp: number): Promise<Operation[]> {
    const rows = await query<OperationRow>(
      `SELECT * FROM operations WHERE file_id = $1 AND timestamp > $2 ORDER BY timestamp ASC`,
      [fileId, sinceTimestamp]
    );
    return rows.map(this.mapOperationRow);
  }

  /**
   * Processes an operation: updates clock, applies to canvas, stores, and persists.
   * The main entry point for handling incoming operations.
   * @param operation - The operation to process
   * @returns Promise resolving to the new canvas state
   */
  // Process and apply operation
  async processOperation(operation: Operation): Promise<CanvasData> {
    this.updateClock(operation.timestamp);

    // Get current file
    const file = await fileService.getFile(operation.fileId);
    if (!file) throw new Error('File not found');

    // Apply operation
    const newCanvasData = this.applyOperation(file.canvas_data, operation);

    // Store operation
    await this.storeOperation(operation);

    // Update file
    await fileService.updateCanvasData(operation.fileId, newCanvasData);

    return newCanvasData;
  }

  /**
   * Factory method to create a new operation with proper metadata.
   * Generates ID and timestamp for the operation.
   * @param fileId - The file this operation applies to
   * @param userId - The user performing the operation
   * @param operationType - The type of operation
   * @param objectId - The object being modified
   * @param newValue - The new value (for create/update/move)
   * @param oldValue - The previous value (for update/delete)
   * @param propertyPath - Dot-path to specific property (for partial updates)
   * @returns A new Operation object ready for processing
   */
  // Create an operation
  createOperation(
    fileId: string,
    userId: string,
    operationType: 'create' | 'update' | 'delete' | 'move',
    objectId: string,
    newValue?: unknown,
    oldValue?: unknown,
    propertyPath?: string
  ): Operation {
    return {
      id: uuidv4(),
      fileId,
      userId,
      operationType,
      objectId,
      propertyPath,
      oldValue,
      newValue,
      timestamp: this.getNextTimestamp(),
      clientId: `server-${process.env.PORT || 3000}`,
    };
  }

  /**
   * Maps a database row to an Operation object.
   * Handles type conversion and null-to-undefined mapping.
   * @param row - The database row to map
   * @returns The mapped Operation object
   */
  private mapOperationRow(row: OperationRow): Operation {
    return {
      id: row.id,
      fileId: row.file_id,
      userId: row.user_id || '',
      operationType: row.operation_type as Operation['operationType'],
      objectId: row.object_id,
      propertyPath: row.property_path || undefined,
      oldValue: row.old_value,
      newValue: row.new_value,
      timestamp: parseInt(row.timestamp),
      clientId: row.client_id,
    };
  }
}

/**
 * Singleton instance of the OperationService.
 * Used throughout the application for operation processing.
 */
export const operationService = new OperationService();
