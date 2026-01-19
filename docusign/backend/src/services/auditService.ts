import crypto from 'crypto';
import { v4 as uuid } from 'uuid';
import { query } from '../utils/db.js';

export interface AuditEvent {
  id: string;
  envelopeId: string;
  eventType: string;
  data: Record<string, unknown>;
  timestamp: string;
  actor: string;
  previousHash?: string;
  hash?: string;
}

export interface AuditEventRow {
  id: string;
  envelope_id: string;
  event_type: string;
  data: string | Record<string, unknown>;
  timestamp: string;
  actor: string;
  previous_hash: string;
  hash: string;
}

export interface ChainVerificationResult {
  valid: boolean;
  eventCount?: number;
  error?: string;
  eventId?: string;
  expected?: string;
  found?: string;
}

export interface CertificateSigner {
  name: string;
  email: string;
  signedAt: string;
  ipAddress: string;
}

export interface CertificateEvent {
  id: string;
  time: string;
  action: string;
  actor: string;
  details: string;
  hash: string;
}

export interface CertificateData {
  envelopeId: string;
  envelopeName: string;
  documentName: string;
  status: string;
  createdAt: string;
  completedAt: string | null;
  chainVerified: boolean;
  signers: CertificateSigner[];
  events: CertificateEvent[];
  eventCount: number;
}

interface EnvelopeRow {
  id: string;
  name: string;
  status: string;
  created_at: string;
  completed_at: string | null;
  document_name?: string;
}

interface RecipientRow {
  id: string;
  name: string;
  email: string;
  completed_at: string;
  ip_address: string;
}

class AuditService {
  // Log an event with hash chain integrity
  async log(
    envelopeId: string,
    eventType: string,
    data: Record<string, unknown>,
    actor: string = 'system'
  ): Promise<AuditEvent> {
    const event: AuditEvent = {
      id: uuid(),
      envelopeId,
      eventType,
      data,
      timestamp: new Date().toISOString(),
      actor: (data.recipientId as string) || (data.userId as string) || actor
    };

    // Get previous event's hash for chain
    const previousEvent = await this.getLastEvent(envelopeId);
    const previousHash = previousEvent?.hash || '0'.repeat(64);

    event.previousHash = previousHash;
    event.hash = this.calculateHash(event);

    // Store in database (append-only)
    await query(
      `INSERT INTO audit_events
        (id, envelope_id, event_type, data, timestamp, actor, previous_hash, hash)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [event.id, envelopeId, eventType, JSON.stringify(data),
       event.timestamp, event.actor, previousHash, event.hash]
    );

    return event;
  }

  // Calculate SHA-256 hash for event
  calculateHash(event: AuditEvent): string {
    const payload = JSON.stringify({
      id: event.id,
      envelopeId: event.envelopeId,
      eventType: event.eventType,
      data: event.data,
      timestamp: event.timestamp,
      previousHash: event.previousHash
    });

    return crypto.createHash('sha256').update(payload).digest('hex');
  }

  // Get the last event for an envelope
  async getLastEvent(envelopeId: string): Promise<AuditEventRow | null> {
    const result = await query<AuditEventRow>(
      `SELECT * FROM audit_events
       WHERE envelope_id = $1
       ORDER BY timestamp DESC
       LIMIT 1`,
      [envelopeId]
    );
    return result.rows[0] || null;
  }

  // Get all events for an envelope
  async getEvents(envelopeId: string): Promise<AuditEventRow[]> {
    const result = await query<AuditEventRow>(
      `SELECT * FROM audit_events
       WHERE envelope_id = $1
       ORDER BY timestamp ASC`,
      [envelopeId]
    );
    return result.rows;
  }

  // Verify the integrity of the audit chain
  async verifyChain(envelopeId: string): Promise<ChainVerificationResult> {
    const events = await this.getEvents(envelopeId);
    let previousHash = '0'.repeat(64);

    for (const event of events) {
      // Verify chain link
      if (event.previous_hash !== previousHash) {
        return {
          valid: false,
          error: 'Chain broken',
          eventId: event.id,
          expected: previousHash,
          found: event.previous_hash
        };
      }

      // Verify event hash
      const calculatedHash = this.calculateHash({
        id: event.id,
        envelopeId: event.envelope_id,
        eventType: event.event_type,
        data: typeof event.data === 'string' ? JSON.parse(event.data) : event.data,
        timestamp: event.timestamp,
        previousHash: event.previous_hash,
        actor: event.actor
      });

      if (calculatedHash !== event.hash) {
        return {
          valid: false,
          error: 'Hash mismatch',
          eventId: event.id,
          expected: calculatedHash,
          found: event.hash
        };
      }

      previousHash = event.hash;
    }

    return { valid: true, eventCount: events.length };
  }

  // Format event details for display
  formatEventDetails(event: AuditEventRow): string {
    const data = typeof event.data === 'string' ? JSON.parse(event.data) : event.data;

    switch (event.event_type) {
      case 'envelope_created':
        return 'Envelope created';
      case 'document_added':
        return `Document "${data.documentName}" added`;
      case 'field_added':
        return `${data.fieldType} field added on page ${data.pageNumber}`;
      case 'recipient_added':
        return `Recipient ${data.email} added`;
      case 'envelope_sent':
        return 'Envelope sent for signing';
      case 'signing_started':
        return `${data.recipientEmail} opened document`;
      case 'signature_captured':
        return `${data.recipientEmail} signed`;
      case 'field_completed':
        return `Field completed by ${data.recipientEmail}`;
      case 'recipient_completed':
        return `${data.recipientEmail} completed all fields`;
      case 'envelope_completed':
        return 'All signatures collected';
      case 'envelope_declined':
        return `Declined by ${data.recipientEmail}: ${data.reason}`;
      case 'envelope_voided':
        return `Voided: ${data.reason}`;
      default:
        return event.event_type;
    }
  }

  // Generate certificate data for an envelope
  async generateCertificateData(envelopeId: string): Promise<CertificateData> {
    const events = await this.getEvents(envelopeId);
    const verification = await this.verifyChain(envelopeId);

    // Get envelope and document info
    const envelopeResult = await query<EnvelopeRow>(
      `SELECT e.*, d.name as document_name
       FROM envelopes e
       LEFT JOIN documents d ON d.envelope_id = e.id
       WHERE e.id = $1`,
      [envelopeId]
    );
    const envelope = envelopeResult.rows[0];

    // Get completed recipients
    const recipientsResult = await query<RecipientRow>(
      `SELECT * FROM recipients
       WHERE envelope_id = $1 AND status = 'completed'
       ORDER BY completed_at ASC`,
      [envelopeId]
    );

    return {
      envelopeId,
      envelopeName: envelope.name,
      documentName: envelope.document_name || '',
      status: envelope.status,
      createdAt: envelope.created_at,
      completedAt: envelope.completed_at,
      chainVerified: verification.valid,
      signers: recipientsResult.rows.map(r => ({
        name: r.name,
        email: r.email,
        signedAt: r.completed_at,
        ipAddress: r.ip_address
      })),
      events: events.map(e => ({
        id: e.id,
        time: e.timestamp,
        action: e.event_type,
        actor: e.actor,
        details: this.formatEventDetails(e),
        hash: e.hash
      })),
      eventCount: events.length
    };
  }
}

export const auditService = new AuditService();
