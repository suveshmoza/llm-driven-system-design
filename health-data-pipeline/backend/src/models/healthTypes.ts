// Health data type configurations

export type AggregationType = 'sum' | 'average' | 'latest' | 'min' | 'max';
export type HealthCategory = 'activity' | 'vitals' | 'body' | 'sleep';

export interface HealthDataTypeConfig {
  unit: string;
  aggregation: AggregationType;
  category: HealthCategory;
}

export type HealthDataTypeKey =
  | 'STEPS'
  | 'DISTANCE'
  | 'ACTIVE_ENERGY'
  | 'FLOORS_CLIMBED'
  | 'STAND_HOURS'
  | 'EXERCISE_MINUTES'
  | 'HEART_RATE'
  | 'RESTING_HEART_RATE'
  | 'BLOOD_PRESSURE_SYSTOLIC'
  | 'BLOOD_PRESSURE_DIASTOLIC'
  | 'BLOOD_GLUCOSE'
  | 'OXYGEN_SATURATION'
  | 'HRV'
  | 'WEIGHT'
  | 'BODY_FAT'
  | 'SLEEP_ANALYSIS';

export const HealthDataTypes: Record<HealthDataTypeKey, HealthDataTypeConfig> = {
  // Activity types (sum aggregation)
  STEPS: { unit: 'count', aggregation: 'sum', category: 'activity' },
  DISTANCE: { unit: 'meters', aggregation: 'sum', category: 'activity' },
  ACTIVE_ENERGY: { unit: 'kcal', aggregation: 'sum', category: 'activity' },
  FLOORS_CLIMBED: { unit: 'count', aggregation: 'sum', category: 'activity' },
  STAND_HOURS: { unit: 'count', aggregation: 'sum', category: 'activity' },
  EXERCISE_MINUTES: { unit: 'minutes', aggregation: 'sum', category: 'activity' },

  // Vitals (average aggregation)
  HEART_RATE: { unit: 'bpm', aggregation: 'average', category: 'vitals' },
  RESTING_HEART_RATE: { unit: 'bpm', aggregation: 'average', category: 'vitals' },
  BLOOD_PRESSURE_SYSTOLIC: { unit: 'mmHg', aggregation: 'average', category: 'vitals' },
  BLOOD_PRESSURE_DIASTOLIC: { unit: 'mmHg', aggregation: 'average', category: 'vitals' },
  BLOOD_GLUCOSE: { unit: 'mg/dL', aggregation: 'average', category: 'vitals' },
  OXYGEN_SATURATION: { unit: 'percent', aggregation: 'average', category: 'vitals' },
  HRV: { unit: 'ms', aggregation: 'average', category: 'vitals' },

  // Body measurements (latest aggregation)
  WEIGHT: { unit: 'kg', aggregation: 'latest', category: 'body' },
  BODY_FAT: { unit: 'percent', aggregation: 'latest', category: 'body' },

  // Sleep (sum aggregation)
  SLEEP_ANALYSIS: { unit: 'minutes', aggregation: 'sum', category: 'sleep' }
};

export type DeviceType =
  | 'apple_watch'
  | 'iphone'
  | 'ipad'
  | 'third_party_wearable'
  | 'third_party_scale'
  | 'manual_entry';

// Device priority for deduplication (higher = preferred)
export const DevicePriority: Record<DeviceType, number> = {
  apple_watch: 100,
  iphone: 80,
  ipad: 70,
  third_party_wearable: 50,
  third_party_scale: 40,
  manual_entry: 10
};

type UnitConversionKey =
  | 'miles_to_meters'
  | 'km_to_meters'
  | 'feet_to_meters'
  | 'lbs_to_kg'
  | 'stones_to_kg'
  | 'fahrenheit_to_celsius';

// Unit conversion helpers
export const UnitConversions: Record<UnitConversionKey, (val: number) => number> = {
  // Distance
  miles_to_meters: (val: number): number => val * 1609.344,
  km_to_meters: (val: number): number => val * 1000,
  feet_to_meters: (val: number): number => val * 0.3048,

  // Weight
  lbs_to_kg: (val: number): number => val * 0.453592,
  stones_to_kg: (val: number): number => val * 6.35029,

  // Temperature
  fahrenheit_to_celsius: (val: number): number => (val - 32) * 5 / 9
};

export function normalizeUnit(value: number, fromUnit: string, toUnit: string): number {
  const conversionKey = `${fromUnit}_to_${toUnit}` as UnitConversionKey;
  const converter = UnitConversions[conversionKey];

  if (converter) {
    return converter(value);
  }

  return value;
}

export function validateHealthType(type: string): boolean {
  return type in HealthDataTypes;
}

export function getAggregationType(type: string): AggregationType {
  const config = HealthDataTypes[type as HealthDataTypeKey];
  return config ? config.aggregation : 'average';
}
