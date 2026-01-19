import { Router, Request, Response } from 'express';
import { v4 as uuid } from 'uuid';
import { query } from '../utils/db.js';
import { uploadSignature, getSignatureUrl } from '../shared/storageWithBreaker.js';
import { getDocumentBuffer } from '../utils/minio.js';
import { setSigningSession } from '../utils/redis.js';
import { authenticateSigner, SignerData } from '../middleware/auth.js';
import { auditService } from '../services/auditService.js';
import { workflowEngine } from '../services/workflowEngine.js';
import {
  executeWithIdempotency,
  generateSignatureIdempotencyKey,
  generateCompletionIdempotencyKey,
} from '../shared/idempotency.js';
import {
  logSignatureCapture,
  logDuplicateSignatureBlocked,
  logAuthEvent,
  AUDIT_EVENTS,
  logAuditEvent,
} from '../shared/auditLogger.js';
import { signaturesCaptured, signaturesCompleted } from '../shared/metrics.js';
import logger from '../shared/logger.js';
import { Socket } from 'net';

const router = Router();

interface RecipientRow {
  id: string;
  envelope_id: string;
  name: string;
  email: string;
  role: string;
  status: string;
  access_token: string;
  envelope_name?: string;
  envelope_status?: string;
  envelope_message?: string;
  authentication_level?: string;
}

interface DocumentRow {
  id: string;
  envelope_id: string;
  name: string;
  s3_key: string;
}

interface FieldRow {
  id: string;
  document_id: string;
  recipient_id: string;
  type: string;
  page_number: number;
  x: number;
  y: number;
  width: number;
  height: number;
  required: boolean;
  completed: boolean;
  envelope_id?: string;
}

interface SignatureRow {
  id: string;
  recipient_id: string;
  field_id: string;
  s3_key: string;
  type: string;
}

interface SignatureResult {
  signatureId: string;
  fieldId: string;
  completed: boolean;
  recipientComplete: boolean;
}

interface RequestWithSocket extends Request {
  connection: Socket;
}

// Get signing session info
router.get('/session/:accessToken', async (req: Request, res: Response): Promise<void> => {
  try {
    const { accessToken } = req.params;

    // Get recipient and envelope info
    const result = await query<RecipientRow>(
      `SELECT r.*, e.name as envelope_name, e.status as envelope_status,
              e.message as envelope_message, e.authentication_level
       FROM recipients r
       JOIN envelopes e ON r.envelope_id = e.id
       WHERE r.access_token = $1`,
      [accessToken]
    );

    if (result.rows.length === 0) {
      res.status(404).json({ error: 'Invalid signing link' });
      return;
    }

    const recipient = result.rows[0];

    // Check envelope status
    if (!['sent', 'delivered'].includes(recipient.envelope_status || '')) {
      res.status(400).json({
        error: 'This document is no longer available for signing',
        status: recipient.envelope_status
      });
      return;
    }

    // Check recipient status
    if (recipient.status === 'completed') {
      res.status(400).json({ error: 'You have already signed this document' });
      return;
    }

    if (recipient.status === 'declined') {
      res.status(400).json({ error: 'This signing request was declined' });
      return;
    }

    // Get documents for this envelope
    const docsResult = await query<DocumentRow>(
      'SELECT * FROM documents WHERE envelope_id = $1 ORDER BY created_at ASC',
      [recipient.envelope_id]
    );

    // Get fields assigned to this recipient
    const fieldsResult = await query<FieldRow>(
      `SELECT df.*
       FROM document_fields df
       JOIN documents d ON df.document_id = d.id
       WHERE d.envelope_id = $1 AND df.recipient_id = $2
       ORDER BY df.page_number ASC, df.y ASC`,
      [recipient.envelope_id, recipient.id]
    );

    // Cache signing session in Redis
    await setSigningSession(accessToken, {
      recipientId: recipient.id,
      envelopeId: recipient.envelope_id,
      envelope_status: recipient.envelope_status || '',
      status: recipient.status
    });

    // Log successful authentication
    await logAuthEvent(recipient.envelope_id, true, {
      recipientId: recipient.id,
      authMethod: 'email_link',
      ipAddress: req.ip,
      userAgent: req.get('User-Agent'),
    });

    res.json({
      recipient: {
        id: recipient.id,
        name: recipient.name,
        email: recipient.email,
        role: recipient.role,
        status: recipient.status
      },
      envelope: {
        id: recipient.envelope_id,
        name: recipient.envelope_name,
        message: recipient.envelope_message,
        status: recipient.envelope_status
      },
      documents: docsResult.rows,
      fields: fieldsResult.rows,
      authenticationRequired: recipient.authentication_level !== 'email'
    });
  } catch (error) {
    const err = error as Error;
    logger.error({ error: err.message }, 'Get signing session error');
    res.status(500).json({ error: 'Failed to get signing session' });
  }
});

// Get document for signing (public, requires access token)
router.get('/document/:accessToken/:documentId', async (req: Request, res: Response): Promise<void> => {
  try {
    const { accessToken, documentId } = req.params;

    // Verify access token belongs to a recipient in this envelope
    const recipientResult = await query<RecipientRow>(
      `SELECT r.*, e.status as envelope_status
       FROM recipients r
       JOIN envelopes e ON r.envelope_id = e.id
       WHERE r.access_token = $1`,
      [accessToken]
    );

    if (recipientResult.rows.length === 0) {
      res.status(401).json({ error: 'Invalid signing link' });
      return;
    }

    const recipient = recipientResult.rows[0];

    // Verify document belongs to this envelope
    const docResult = await query<DocumentRow>(
      'SELECT * FROM documents WHERE id = $1 AND envelope_id = $2',
      [documentId, recipient.envelope_id]
    );

    if (docResult.rows.length === 0) {
      res.status(404).json({ error: 'Document not found' });
      return;
    }

    const document = docResult.rows[0];

    // Log document view with enhanced audit
    await logAuditEvent(recipient.envelope_id, AUDIT_EVENTS.DOCUMENT_VIEWED, {
      recipientId: recipient.id,
      recipientEmail: recipient.email,
      documentId,
      documentName: document.name,
    }, {
      ipAddress: req.ip,
      userAgent: req.get('User-Agent'),
    });

    // Also use legacy audit service for backward compatibility
    await auditService.log(recipient.envelope_id, 'signing_started', {
      recipientId: recipient.id,
      recipientEmail: recipient.email,
      documentId,
      documentName: document.name,
      ipAddress: req.ip,
      userAgent: req.get('User-Agent')
    }, recipient.id);

    // Get document from MinIO
    const buffer = await getDocumentBuffer(document.s3_key);

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${document.name}"`);
    res.send(buffer);
  } catch (error) {
    const err = error as Error;
    logger.error({ error: err.message }, 'Get signing document error');
    res.status(500).json({ error: 'Failed to get document' });
  }
});

// Capture signature - WITH IDEMPOTENCY FOR LEGAL COMPLIANCE
router.post('/sign/:accessToken', authenticateSigner, async (req: Request, res: Response): Promise<void> => {
  try {
    const { fieldId, signatureData, type = 'draw' } = req.body;

    if (!fieldId || !signatureData) {
      res.status(400).json({ error: 'fieldId and signatureData are required' });
      return;
    }

    const recipient = req.signer as SignerData;
    const reqWithSocket = req as RequestWithSocket;
    const ipAddress = req.ip || reqWithSocket.connection?.remoteAddress || '';
    const userAgent = req.get('User-Agent') || '';

    // Verify field belongs to this recipient
    const fieldResult = await query<FieldRow>(
      `SELECT df.*, d.envelope_id
       FROM document_fields df
       JOIN documents d ON df.document_id = d.id
       WHERE df.id = $1`,
      [fieldId]
    );

    if (fieldResult.rows.length === 0) {
      res.status(404).json({ error: 'Field not found' });
      return;
    }

    const field = fieldResult.rows[0];

    if (field.recipient_id !== recipient.id) {
      res.status(403).json({ error: 'This field is not assigned to you' });
      return;
    }

    if (field.completed) {
      res.status(400).json({ error: 'This field has already been completed' });
      return;
    }

    // Generate idempotency key for this signature operation
    // CRITICAL: This prevents duplicate signatures due to network retries
    const idempotencyKey = (req.headers['x-idempotency-key'] as string) ||
      generateSignatureIdempotencyKey(fieldId, recipient.id);

    // Execute with idempotency protection
    const { data: result, cached } = await executeWithIdempotency<SignatureResult>(
      idempotencyKey,
      async () => {
        // Process signature image
        let signatureBuffer: Buffer;
        if (signatureData.startsWith('data:image')) {
          const base64Data = signatureData.split(',')[1];
          signatureBuffer = Buffer.from(base64Data, 'base64');
        } else {
          signatureBuffer = Buffer.from(signatureData, 'base64');
        }

        // Store signature in MinIO (with circuit breaker)
        const signatureId = uuid();
        const s3Key = `signatures/${signatureId}.png`;
        await uploadSignature(s3Key, signatureBuffer, 'image/png');

        // Create signature record
        await query(
          `INSERT INTO signatures (id, recipient_id, field_id, s3_key, type, ip_address, user_agent)
           VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [signatureId, recipient.id, fieldId, s3Key, type, ipAddress, userAgent]
        );

        // Update field as completed
        await query(
          `UPDATE document_fields
           SET completed = true, signature_id = $2
           WHERE id = $1`,
          [fieldId, signatureId]
        );

        // Log enhanced audit event for legal compliance
        await logSignatureCapture({
          envelopeId: field.envelope_id || '',
          recipientId: recipient.id,
          recipientEmail: recipient.email,
          recipientName: recipient.name,
          fieldId,
          signatureId,
          signatureType: type,
          ipAddress,
          userAgent,
        });

        // Also use legacy audit service
        await auditService.log(field.envelope_id || '', 'signature_captured', {
          recipientId: recipient.id,
          recipientEmail: recipient.email,
          fieldId,
          signatureId,
          type,
          ipAddress,
          userAgent,
          timestamp: new Date().toISOString()
        }, recipient.id);

        // Update metrics
        signaturesCaptured.inc();

        // Check if recipient has completed all required fields
        const isComplete = await workflowEngine.checkRecipientCompletion(recipient.id);

        return {
          signatureId,
          fieldId,
          completed: true,
          recipientComplete: isComplete
        };
      },
      'signature'
    );

    // If this was a duplicate request, log it for security monitoring
    if (cached) {
      await logDuplicateSignatureBlocked({
        envelopeId: field.envelope_id || '',
        recipientId: recipient.id,
        fieldId,
        idempotencyKey,
        ipAddress,
        userAgent,
      });

      logger.info({
        idempotencyKey,
        fieldId,
        recipientId: recipient.id,
      }, 'Duplicate signature request blocked by idempotency');
    }

    res.json(result);
  } catch (error) {
    const err = error as Error;
    logger.error({ error: err.message }, 'Capture signature error');
    res.status(500).json({ error: 'Failed to capture signature' });
  }
});

// Complete field (for non-signature fields like date, text, checkbox)
router.post('/complete-field/:accessToken', authenticateSigner, async (req: Request, res: Response): Promise<void> => {
  try {
    const { fieldId, value } = req.body;

    if (!fieldId) {
      res.status(400).json({ error: 'fieldId is required' });
      return;
    }

    const recipient = req.signer as SignerData;
    const reqWithSocket = req as RequestWithSocket;
    const ipAddress = req.ip || reqWithSocket.connection?.remoteAddress || '';
    const userAgent = req.get('User-Agent') || '';

    // Verify field belongs to this recipient
    const fieldResult = await query<FieldRow>(
      `SELECT df.*, d.envelope_id
       FROM document_fields df
       JOIN documents d ON df.document_id = d.id
       WHERE df.id = $1`,
      [fieldId]
    );

    if (fieldResult.rows.length === 0) {
      res.status(404).json({ error: 'Field not found' });
      return;
    }

    const field = fieldResult.rows[0];

    if (field.recipient_id !== recipient.id) {
      res.status(403).json({ error: 'This field is not assigned to you' });
      return;
    }

    if (field.completed) {
      res.status(400).json({ error: 'This field has already been completed' });
      return;
    }

    // For signature/initial fields, redirect to sign endpoint
    if (['signature', 'initial'].includes(field.type)) {
      res.status(400).json({
        error: 'Use the /sign endpoint for signature and initial fields'
      });
      return;
    }

    // Set value based on field type
    let fieldValue = value;
    if (field.type === 'date') {
      fieldValue = value || new Date().toISOString().split('T')[0];
    } else if (field.type === 'checkbox') {
      fieldValue = value === true || value === 'true' ? 'checked' : 'unchecked';
    }

    // Update field
    await query(
      `UPDATE document_fields
       SET completed = true, value = $2
       WHERE id = $1`,
      [fieldId, fieldValue]
    );

    // Log enhanced audit event
    await logAuditEvent(field.envelope_id || '', AUDIT_EVENTS.FIELD_COMPLETED, {
      recipientId: recipient.id,
      recipientEmail: recipient.email,
      fieldId,
      fieldType: field.type,
      value: fieldValue,
    }, {
      ipAddress,
      userAgent,
    });

    // Also use legacy audit service
    await auditService.log(field.envelope_id || '', 'field_completed', {
      recipientId: recipient.id,
      recipientEmail: recipient.email,
      fieldId,
      fieldType: field.type,
      ipAddress,
      userAgent,
      timestamp: new Date().toISOString()
    }, recipient.id);

    // Check if recipient has completed all required fields
    const isComplete = await workflowEngine.checkRecipientCompletion(recipient.id);

    res.json({
      fieldId,
      value: fieldValue,
      completed: true,
      recipientComplete: isComplete
    });
  } catch (error) {
    const err = error as Error;
    logger.error({ error: err.message }, 'Complete field error');
    res.status(500).json({ error: 'Failed to complete field' });
  }
});

// Finish signing (mark recipient as complete) - WITH IDEMPOTENCY
router.post('/finish/:accessToken', authenticateSigner, async (req: Request, res: Response): Promise<void> => {
  try {
    const recipient = req.signer as SignerData;
    const reqWithSocket = req as RequestWithSocket;
    const ipAddress = req.ip || reqWithSocket.connection?.remoteAddress || '';
    const userAgent = req.get('User-Agent') || '';

    // Check all required fields are complete
    const incompleteResult = await query<FieldRow>(
      `SELECT df.* FROM document_fields df
       JOIN documents d ON df.document_id = d.id
       WHERE d.envelope_id = $1 AND df.recipient_id = $2 AND df.required = true AND df.completed = false`,
      [recipient.envelope_id, recipient.id]
    );

    if (incompleteResult.rows.length > 0) {
      res.status(400).json({
        error: 'Please complete all required fields before finishing',
        incompleteFields: incompleteResult.rows.map(f => ({
          id: f.id,
          type: f.type,
          pageNumber: f.page_number
        }))
      });
      return;
    }

    // Generate idempotency key for completion
    const idempotencyKey = (req.headers['x-idempotency-key'] as string) ||
      generateCompletionIdempotencyKey(recipient.id);

    // Execute with idempotency protection
    const { data: result, cached } = await executeWithIdempotency<{ message: string; recipientId: string }>(
      idempotencyKey,
      async () => {
        // Mark recipient as complete
        await workflowEngine.completeRecipient(recipient.id, ipAddress, userAgent);

        // Update metrics
        signaturesCompleted.inc();

        return {
          message: 'Signing completed successfully',
          recipientId: recipient.id
        };
      },
      'completion'
    );

    if (cached) {
      logger.info({
        idempotencyKey,
        recipientId: recipient.id,
      }, 'Duplicate completion request blocked by idempotency');
    }

    res.json(result);
  } catch (error) {
    const err = error as Error;
    logger.error({ error: err.message }, 'Finish signing error');
    res.status(500).json({ error: 'Failed to complete signing' });
  }
});

// Decline to sign
router.post('/decline/:accessToken', authenticateSigner, async (req: Request, res: Response): Promise<void> => {
  try {
    const { reason } = req.body;
    const recipient = req.signer as SignerData;
    const reqWithSocket = req as RequestWithSocket;
    const ipAddress = req.ip || reqWithSocket.connection?.remoteAddress || '';
    const userAgent = req.get('User-Agent') || '';

    await workflowEngine.declineEnvelope(recipient.id, reason, ipAddress, userAgent);

    res.json({
      message: 'Document declined',
      recipientId: recipient.id
    });
  } catch (error) {
    const err = error as Error;
    logger.error({ error: err.message }, 'Decline signing error');
    res.status(500).json({ error: 'Failed to decline' });
  }
});

// Get signature image
router.get('/signature-image/:signatureId/:accessToken', authenticateSigner, async (req: Request, res: Response): Promise<void> => {
  try {
    const { signatureId } = req.params;
    const signer = req.signer as SignerData;

    const result = await query<SignatureRow>(
      'SELECT * FROM signatures WHERE id = $1 AND recipient_id = $2',
      [signatureId, signer.id]
    );

    if (result.rows.length === 0) {
      res.status(404).json({ error: 'Signature not found' });
      return;
    }

    const signatureUrl = await getSignatureUrl(result.rows[0].s3_key);

    res.json({ url: signatureUrl });
  } catch (error) {
    const err = error as Error;
    logger.error({ error: err.message }, 'Get signature image error');
    res.status(500).json({ error: 'Failed to get signature image' });
  }
});

export default router;
