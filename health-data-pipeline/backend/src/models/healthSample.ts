import { v4 as uuidv4 } from 'uuid';
import { HealthDataTypes, normalizeUnit, HealthDataTypeKey } from './healthTypes.js';

export interface HealthSampleData {
  id?: string;
  userId: string;
  type: string;
  value: number;
  unit?: string;
  startDate: Date | string;
  endDate?: Date | string;
  sourceDevice?: string;
  sourceDeviceId?: string;
  sourceApp?: string;
  metadata?: Record<string, unknown>;
}

export interface HealthSampleRow {
  id: string;
  user_id: string;
  type: string;
  value: number;
  unit: string;
  start_date: Date;
  end_date: Date;
  source_device: string | null;
  source_device_id: string | null;
  source_app: string | null;
  metadata: Record<string, unknown> | null;
}

export class HealthSample {
  id: string;
  userId: string;
  type: string;
  value: number;
  unit: string | undefined;
  startDate: Date;
  endDate: Date;
  sourceDevice: string | undefined;
  sourceDeviceId: string | undefined;
  sourceApp: string | undefined;
  metadata: Record<string, unknown>;
  createdAt: Date;

  constructor(data: HealthSampleData) {
    this.id = data.id || uuidv4();
    this.userId = data.userId;
    this.type = data.type;
    this.value = data.value;
    this.unit = data.unit;
    this.startDate = new Date(data.startDate);
    this.endDate = new Date(data.endDate || data.startDate);
    this.sourceDevice = data.sourceDevice;
    this.sourceDeviceId = data.sourceDeviceId;
    this.sourceApp = data.sourceApp;
    this.metadata = data.metadata || {};
    this.createdAt = new Date();
  }

  validate(): boolean {
    // Check required fields
    if (!this.userId) {
      throw new Error('userId is required');
    }
    if (!this.type) {
      throw new Error('type is required');
    }
    if (this.value === undefined || this.value === null) {
      throw new Error('value is required');
    }
    if (!this.startDate || isNaN(this.startDate.getTime())) {
      throw new Error('valid startDate is required');
    }

    // Validate health type
    const typeConfig = HealthDataTypes[this.type as HealthDataTypeKey];
    if (!typeConfig) {
      throw new Error(`Unknown health type: ${this.type}`);
    }

    // Normalize unit if needed
    if (this.unit && typeConfig.unit && this.unit !== typeConfig.unit) {
      this.value = normalizeUnit(this.value, this.unit, typeConfig.unit);
      this.unit = typeConfig.unit;
    } else if (!this.unit && typeConfig.unit) {
      this.unit = typeConfig.unit;
    }

    // Validate value range
    if (typeof this.value !== 'number' || isNaN(this.value)) {
      throw new Error('value must be a valid number');
    }

    return true;
  }

  toRow(): HealthSampleRow {
    return {
      id: this.id,
      user_id: this.userId,
      type: this.type,
      value: this.value,
      unit: this.unit || '',
      start_date: this.startDate,
      end_date: this.endDate,
      source_device: this.sourceDevice || null,
      source_device_id: this.sourceDeviceId || null,
      source_app: this.sourceApp || null,
      metadata: this.metadata
    };
  }

  static fromRow(row: HealthSampleRow): HealthSample {
    return new HealthSample({
      id: row.id,
      userId: row.user_id,
      type: row.type,
      value: row.value,
      unit: row.unit,
      startDate: row.start_date,
      endDate: row.end_date,
      sourceDevice: row.source_device || undefined,
      sourceDeviceId: row.source_device_id || undefined,
      sourceApp: row.source_app || undefined,
      metadata: row.metadata || {}
    });
  }
}
