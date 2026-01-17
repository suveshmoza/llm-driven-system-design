# Health Data Pipeline - System Design Interview Answer

## Opening Statement (1 minute)

"I'll design a health data pipeline like Apple Health, which collects metrics from multiple devices, deduplicates overlapping data, and generates actionable health insights while maintaining strict privacy. The key challenges are handling data from diverse sources with different formats, accurately deduplicating overlapping measurements from multiple devices, and protecting highly sensitive health information.

The core technical challenges are building a priority-based deduplication algorithm that handles overlapping time ranges from multiple devices, implementing time-series aggregation at multiple granularities, and ensuring end-to-end encryption with user-controlled data sharing."

## Requirements Clarification (3 minutes)

### Functional Requirements
- **Ingest**: Collect data from multiple devices (Apple Watch, iPhone, third-party)
- **Process**: Aggregate, deduplicate, normalize data
- **Store**: Persist with encryption
- **Query**: Fast access to historical data
- **Share**: Controlled data sharing with providers

### Non-Functional Requirements
- **Privacy**: All data encrypted, minimal exposure
- **Reliability**: Zero data loss
- **Latency**: < 1 second for recent data queries
- **Compliance**: HIPAA-ready architecture

### Scale Estimates
- Millions of users with health data
- Each user has multiple devices syncing data
- Hundreds of samples per day per user (heart rate, steps, etc.)
- Years of historical data per user

## High-Level Architecture (5 minutes)

```
+----------------------------------------------------------+
|                      Data Sources                          |
|   Apple Watch | iPhone | Third-Party (scales, BP, etc.)   |
+----------------------------------------------------------+
                           |
                           v
+----------------------------------------------------------+
|                  On-Device Processing                      |
|      Collection Agent | Local DB | Sync Engine             |
+----------------------------------------------------------+
                           | Encrypted Sync
                           v
+----------------------------------------------------------+
|                    Cloud Processing                        |
|  +---------------+  +---------------+  +---------------+  |
|  |   Ingestion   |  |  Aggregation  |  |   Insights    |  |
|  |   Service     |  |   Pipeline    |  |   Engine      |  |
|  +---------------+  +---------------+  +---------------+  |
+----------------------------------------------------------+
                           |
                           v
+----------------------------------------------------------+
|                     Storage Layer                          |
|    TimescaleDB (time-series) | PostgreSQL (metadata)       |
|              Object Store (exports, backups)               |
+----------------------------------------------------------+
```

### Core Components
1. **Ingestion Service** - Validates and normalizes incoming data
2. **Aggregation Pipeline** - Deduplicates and aggregates samples
3. **Insights Engine** - Generates trends and alerts
4. **Privacy Layer** - Encryption and controlled sharing

## Deep Dive: Data Model and Ingestion (8 minutes)

### Health Data Types

```javascript
const HealthDataTypes = {
  // Quantity types (single value at point in time)
  STEPS: { unit: 'count', aggregation: 'sum' },
  DISTANCE: { unit: 'meters', aggregation: 'sum' },
  HEART_RATE: { unit: 'bpm', aggregation: 'average' },
  RESTING_HEART_RATE: { unit: 'bpm', aggregation: 'average' },
  BLOOD_PRESSURE_SYSTOLIC: { unit: 'mmHg', aggregation: 'average' },
  BLOOD_PRESSURE_DIASTOLIC: { unit: 'mmHg', aggregation: 'average' },
  WEIGHT: { unit: 'kg', aggregation: 'latest' },
  BLOOD_GLUCOSE: { unit: 'mg/dL', aggregation: 'average' },
  SLEEP_ANALYSIS: { unit: 'minutes', aggregation: 'sum' },
  ACTIVE_ENERGY: { unit: 'kcal', aggregation: 'sum' },
  OXYGEN_SATURATION: { unit: 'percent', aggregation: 'average' },

  // Category types (state at point in time)
  SLEEP_STATE: { values: ['asleep', 'awake', 'rem', 'deep', 'core'] }
}

class HealthSample {
  constructor(data) {
    this.id = data.id || uuid()
    this.userId = data.userId
    this.type = data.type
    this.value = data.value
    this.unit = data.unit
    this.startDate = new Date(data.startDate)
    this.endDate = new Date(data.endDate)
    this.sourceDevice = data.sourceDevice
    this.sourceApp = data.sourceApp
    this.metadata = data.metadata || {}
  }

  validate() {
    const typeConfig = HealthDataTypes[this.type]
    if (!typeConfig) {
      throw new Error(`Unknown health type: ${this.type}`)
    }

    // Unit normalization
    if (typeConfig.unit && this.unit !== typeConfig.unit) {
      this.value = this.convertUnit(this.value, this.unit, typeConfig.unit)
      this.unit = typeConfig.unit
    }

    return true
  }
}
```

### Device Sync Service

```javascript
class DeviceSyncService {
  async syncFromDevice(userId, deviceId, samples) {
    const validSamples = []
    const errors = []

    // Validate each sample
    for (const sample of samples) {
      try {
        const healthSample = new HealthSample({
          ...sample,
          userId,
          sourceDevice: deviceId
        })
        healthSample.validate()
        validSamples.push(healthSample)
      } catch (error) {
        errors.push({ sample, error: error.message })
      }
    }

    // Batch insert with UPSERT for duplicates
    if (validSamples.length > 0) {
      await this.batchInsert(validSamples)
    }

    // Queue for aggregation
    await this.queue.publish('health-aggregation', {
      userId,
      sampleTypes: [...new Set(validSamples.map(s => s.type))],
      dateRange: this.getDateRange(validSamples)
    })

    return {
      synced: validSamples.length,
      errors: errors.length,
      errorDetails: errors
    }
  }

  async batchInsert(samples) {
    const values = samples.map(s => [
      s.id, s.userId, s.type, s.value, s.unit,
      s.startDate, s.endDate, s.sourceDevice, s.sourceApp,
      JSON.stringify(s.metadata)
    ])

    await db.query(`
      INSERT INTO health_samples
        (id, user_id, type, value, unit, start_date, end_date,
         source_device, source_app, metadata)
      VALUES ${this.buildPlaceholders(values)}
      ON CONFLICT (id) DO NOTHING
    `, values.flat())
  }
}
```

## Deep Dive: Deduplication Algorithm (8 minutes)

When the same health metric comes from multiple devices (e.g., steps from both Apple Watch and iPhone), we need to deduplicate to avoid double-counting.

### Priority-Based Deduplication

```javascript
class AggregationPipeline {
  constructor() {
    // Device priority (higher = more trusted)
    this.devicePriority = {
      'apple_watch': 100,
      'iphone': 80,
      'ipad': 70,
      'third_party_wearable': 50,
      'third_party_scale': 40,
      'manual_entry': 10
    }
  }

  async deduplicateSamples(samples, type) {
    // Sort by priority (highest first)
    const sorted = samples.sort((a, b) =>
      this.getDevicePriority(b.sourceDevice) -
      this.getDevicePriority(a.sourceDevice)
    )

    const result = []
    const coveredRanges = []  // Already accounted time ranges

    for (const sample of sorted) {
      const overlap = this.findOverlap(
        sample.startDate,
        sample.endDate,
        coveredRanges
      )

      if (!overlap) {
        // No overlap - include full sample
        result.push(sample)
        coveredRanges.push({ start: sample.startDate, end: sample.endDate })
      } else if (overlap.partial) {
        // Partial overlap - adjust sample
        const adjusted = this.adjustForOverlap(sample, overlap, type)
        if (adjusted) {
          result.push(adjusted)
          coveredRanges.push({ start: adjusted.startDate, end: adjusted.endDate })
        }
      }
      // Full overlap: skip (higher priority already covers this time)
    }

    return result
  }

  findOverlap(start, end, coveredRanges) {
    for (const range of coveredRanges) {
      // Check if ranges overlap
      if (start < range.end && end > range.start) {
        const overlapStart = Math.max(start, range.start)
        const overlapEnd = Math.min(end, range.end)

        if (overlapStart === start && overlapEnd === end) {
          return { full: true }  // Completely covered
        }

        return {
          partial: true,
          overlapStart,
          overlapEnd
        }
      }
    }
    return null  // No overlap
  }

  adjustForOverlap(sample, overlap, type) {
    const config = HealthDataTypes[type]
    const totalDuration = sample.endDate - sample.startDate
    const overlapDuration = overlap.overlapEnd - overlap.overlapStart

    // Calculate non-overlapping portion
    const remainingDuration = totalDuration - overlapDuration

    if (remainingDuration <= 0) {
      return null  // Fully covered
    }

    // Adjust value proportionally for sum-based metrics
    if (config.aggregation === 'sum') {
      const ratio = remainingDuration / totalDuration
      return {
        ...sample,
        value: sample.value * ratio,
        startDate: overlap.overlapEnd > sample.startDate ? sample.startDate : overlap.overlapEnd,
        endDate: overlap.overlapStart < sample.endDate ? sample.endDate : overlap.overlapStart
      }
    }

    return sample  // For averages, keep full value
  }

  getDevicePriority(device) {
    return this.devicePriority[device] || 0
  }
}
```

### Time-Based Aggregation

```javascript
async aggregateByPeriod(samples, period, aggregationType) {
  const buckets = new Map()  // periodKey -> values[]

  for (const sample of samples) {
    const bucketKey = this.getBucketKey(sample.startDate, period)

    if (!buckets.has(bucketKey)) {
      buckets.set(bucketKey, [])
    }
    buckets.get(bucketKey).push(sample.value)
  }

  const aggregates = []
  for (const [key, values] of buckets) {
    aggregates.push({
      periodStart: new Date(key),
      period,
      value: this.aggregate(values, aggregationType),
      sampleCount: values.length
    })
  }

  return aggregates
}

aggregate(values, type) {
  switch (type) {
    case 'sum':
      return values.reduce((a, b) => a + b, 0)
    case 'average':
      return values.reduce((a, b) => a + b, 0) / values.length
    case 'min':
      return Math.min(...values)
    case 'max':
      return Math.max(...values)
    case 'latest':
      return values[values.length - 1]
    default:
      return values[0]
  }
}

getBucketKey(date, period) {
  const d = new Date(date)
  switch (period) {
    case 'hour':
      return d.setMinutes(0, 0, 0)
    case 'day':
      return d.setHours(0, 0, 0, 0)
    case 'week':
      const day = d.getDay()
      return new Date(d.setDate(d.getDate() - day)).setHours(0, 0, 0, 0)
    case 'month':
      return new Date(d.getFullYear(), d.getMonth(), 1).getTime()
  }
}
```

## Deep Dive: Insights Engine (5 minutes)

### Trend Detection

```javascript
class InsightsEngine {
  async analyzeUser(userId) {
    const insights = []

    // Heart rate trends
    const hrInsight = await this.analyzeHeartRate(userId)
    if (hrInsight) insights.push(hrInsight)

    // Sleep patterns
    const sleepInsight = await this.analyzeSleep(userId)
    if (sleepInsight) insights.push(sleepInsight)

    // Activity trends
    const activityInsight = await this.analyzeActivity(userId)
    if (activityInsight) insights.push(activityInsight)

    // Store and notify
    for (const insight of insights) {
      await this.storeInsight(userId, insight)
      if (insight.severity === 'high') {
        await this.notifyUser(userId, insight)
      }
    }

    return insights
  }

  async analyzeHeartRate(userId) {
    // Get 30 days of resting heart rate
    const data = await db.query(`
      SELECT period_start, value
      FROM health_aggregates
      WHERE user_id = $1
        AND type = 'RESTING_HEART_RATE'
        AND period = 'day'
        AND period_start >= NOW() - INTERVAL '30 days'
      ORDER BY period_start
    `, [userId])

    if (data.rows.length < 7) return null

    const values = data.rows.map(r => r.value)
    const trend = this.calculateTrend(values)

    if (Math.abs(trend.slope) > 0.5) {
      return {
        type: 'HEART_RATE_TREND',
        direction: trend.slope > 0 ? 'increasing' : 'decreasing',
        magnitude: Math.abs(trend.slope),
        period: '30_days',
        message: trend.slope > 0
          ? 'Your resting heart rate has increased over the past month'
          : 'Your resting heart rate has decreased over the past month',
        data: {
          startValue: values[0],
          endValue: values[values.length - 1],
          change: values[values.length - 1] - values[0]
        }
      }
    }

    return null
  }

  calculateTrend(values) {
    // Linear regression for trend detection
    const n = values.length
    const sumX = (n * (n - 1)) / 2
    const sumY = values.reduce((a, b) => a + b, 0)
    const sumXY = values.reduce((sum, val, i) => sum + i * val, 0)
    const sumX2 = (n * (n - 1) * (2 * n - 1)) / 6

    const slope = (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX)
    const intercept = (sumY - slope * sumX) / n

    return { slope, intercept }
  }
}
```

### Sleep Analysis

```javascript
async analyzeSleep(userId) {
  const data = await db.query(`
    SELECT period_start, value
    FROM health_aggregates
    WHERE user_id = $1
      AND type = 'SLEEP_ANALYSIS'
      AND period = 'day'
      AND period_start >= NOW() - INTERVAL '14 days'
    ORDER BY period_start
  `, [userId])

  if (data.rows.length < 7) return null

  const avgSleepMinutes = data.rows.reduce((a, b) => a + b.value, 0) / data.rows.length
  const avgHours = avgSleepMinutes / 60

  if (avgHours < 6) {
    return {
      type: 'SLEEP_DEFICIT',
      severity: avgHours < 5 ? 'high' : 'medium',
      message: `You've been averaging ${avgHours.toFixed(1)} hours of sleep`,
      recommendation: 'Try to get 7-9 hours of sleep for optimal health',
      data: { averageHours: avgHours }
    }
  }

  return null
}
```

## Deep Dive: Privacy and Data Sharing (5 minutes)

### Share Token System

```javascript
class PrivacyService {
  async createShareToken(userId, recipientId, permissions) {
    const token = {
      id: uuid(),
      userId,
      recipientId,
      dataTypes: permissions.dataTypes,
      dateRange: permissions.dateRange,
      expiresAt: permissions.expiresAt,
      createdAt: new Date()
    }

    // Derive sharing key from user's key
    const sharingKey = await this.deriveSharingKey(userId, token.id)

    await db.query(`
      INSERT INTO share_tokens
        (id, user_id, recipient_id, data_types, date_start, date_end,
         expires_at, encrypted_key)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
    `, [
      token.id, userId, recipientId, permissions.dataTypes,
      permissions.dateRange.start, permissions.dateRange.end,
      permissions.expiresAt, await this.encryptKey(sharingKey, recipientId)
    ])

    return token
  }

  async getSharedData(tokenId, recipientId) {
    // Validate share token
    const token = await db.query(`
      SELECT * FROM share_tokens
      WHERE id = $1 AND recipient_id = $2
        AND expires_at > NOW() AND revoked_at IS NULL
    `, [tokenId, recipientId])

    if (token.rows.length === 0) {
      throw new Error('Invalid or expired share token')
    }

    const shareInfo = token.rows[0]

    // Fetch only authorized data
    const data = await db.query(`
      SELECT type, period_start, value
      FROM health_aggregates
      WHERE user_id = $1
        AND type = ANY($2)
        AND period_start >= $3
        AND period_start <= $4
        AND period = 'day'
      ORDER BY type, period_start
    `, [
      shareInfo.user_id,
      shareInfo.data_types,
      shareInfo.date_start,
      shareInfo.date_end
    ])

    return {
      userId: shareInfo.user_id,
      dataTypes: shareInfo.data_types,
      samples: data.rows
    }
  }

  async revokeShareToken(userId, tokenId) {
    await db.query(`
      UPDATE share_tokens
      SET revoked_at = NOW()
      WHERE id = $1 AND user_id = $2
    `, [tokenId, userId])
  }
}
```

## Trade-offs and Alternatives (5 minutes)

### 1. TimescaleDB vs InfluxDB

**Chose: TimescaleDB**
- Pro: PostgreSQL compatibility (familiar SQL)
- Pro: Automatic time-based partitioning
- Pro: Can join with relational tables
- Con: Less mature than InfluxDB for pure time-series
- Alternative: InfluxDB (purpose-built but different query language)

### 2. Pre-Computed Aggregates vs On-Demand

**Chose: Pre-computed aggregates**
- Pro: Fast query performance
- Pro: Reduces load on raw data
- Con: Storage overhead
- Con: Delay before aggregates reflect new data
- Alternative: On-demand aggregation (simpler but slower queries)

### 3. Device Priority vs Time-Based Deduplication

**Chose: Device priority**
- Pro: More accurate (Apple Watch sensors > iPhone)
- Pro: Consistent behavior
- Con: Need to maintain priority rankings
- Alternative: Prefer most recent (simpler but less accurate)

### 4. Per-User Encryption Keys vs Single System Key

**Chose: Per-user keys**
- Pro: User controls their data
- Pro: Enables selective sharing
- Pro: Breach isolation
- Con: Key management complexity
- Alternative: Single system key (simpler but privacy concerns)

### Database Schema

```sql
-- Raw health samples (TimescaleDB hypertable)
CREATE TABLE health_samples (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL,
  type VARCHAR(50) NOT NULL,
  value DOUBLE PRECISION,
  unit VARCHAR(20),
  start_date TIMESTAMP NOT NULL,
  end_date TIMESTAMP NOT NULL,
  source_device VARCHAR(50),
  source_app VARCHAR(100),
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMP DEFAULT NOW()
);

SELECT create_hypertable('health_samples', 'start_date');
CREATE INDEX idx_samples_user_type ON health_samples(user_id, type, start_date DESC);

-- Aggregated data
CREATE TABLE health_aggregates (
  user_id UUID NOT NULL,
  type VARCHAR(50) NOT NULL,
  period VARCHAR(10) NOT NULL,  -- hour, day, week, month
  period_start TIMESTAMP NOT NULL,
  value DOUBLE PRECISION NOT NULL,
  sample_count INTEGER DEFAULT 1,
  updated_at TIMESTAMP DEFAULT NOW(),
  PRIMARY KEY (user_id, type, period, period_start)
);

SELECT create_hypertable('health_aggregates', 'period_start');

-- Share tokens
CREATE TABLE share_tokens (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL,
  recipient_id UUID NOT NULL,
  data_types TEXT[] NOT NULL,
  date_start DATE,
  date_end DATE,
  expires_at TIMESTAMP NOT NULL,
  encrypted_key BYTEA,
  created_at TIMESTAMP DEFAULT NOW(),
  revoked_at TIMESTAMP
);

CREATE INDEX idx_shares_recipient ON share_tokens(recipient_id, expires_at);
```

## Closing Summary (1 minute)

"The health data pipeline is built around three key principles:

1. **Priority-based deduplication** - When the same metric comes from multiple devices, we prioritize by sensor quality (Apple Watch > iPhone > third-party). Overlapping time ranges are handled by proportionally adjusting values.

2. **Multi-level aggregation** - Raw samples are aggregated into hourly, daily, weekly, and monthly buckets. The aggregation method varies by metric type (sum for steps, average for heart rate, latest for weight).

3. **User-controlled privacy** - Each user has their own encryption keys, and sharing is done via time-limited tokens that specify exactly which data types and date ranges can be accessed.

The main trade-off is between accuracy and simplicity. Priority-based deduplication with overlap handling is more complex than simply taking the latest value, but it ensures accurate totals for metrics like steps where double-counting would be misleading."
