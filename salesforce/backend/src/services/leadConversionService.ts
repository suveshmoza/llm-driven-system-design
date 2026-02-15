import { pool } from './db.js';
import { logger } from './logger.js';

interface ConversionInput {
  leadId: string;
  accountName?: string;
  opportunityName?: string;
  opportunityAmount?: number;
  closeDate?: string;
  userId: string;
}

interface ConversionResult {
  accountId: string;
  contactId: string;
  opportunityId: string | null;
}

/** Converts a lead to account + contact + optional opportunity in a single PostgreSQL transaction. */
export async function convertLead(input: ConversionInput): Promise<ConversionResult> {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // Fetch the lead
    const leadResult = await client.query(
      'SELECT * FROM leads WHERE id = $1 AND converted_at IS NULL',
      [input.leadId],
    );

    if (leadResult.rows.length === 0) {
      throw new Error('Lead not found or already converted');
    }

    const lead = leadResult.rows[0];

    // Create account
    const accountName = input.accountName || lead.company || `${lead.first_name} ${lead.last_name}`;
    const accountResult = await client.query(
      `INSERT INTO accounts (name, phone, owner_id)
       VALUES ($1, $2, $3)
       RETURNING id`,
      [accountName, lead.phone, input.userId],
    );
    const accountId = accountResult.rows[0].id;

    // Create contact
    const contactResult = await client.query(
      `INSERT INTO contacts (account_id, first_name, last_name, email, phone, title, owner_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING id`,
      [accountId, lead.first_name, lead.last_name, lead.email, lead.phone, lead.title, input.userId],
    );
    const contactId = contactResult.rows[0].id;

    // Optionally create opportunity
    let opportunityId: string | null = null;
    if (input.opportunityName) {
      const oppResult = await client.query(
        `INSERT INTO opportunities (account_id, name, amount_cents, stage, close_date, owner_id)
         VALUES ($1, $2, $3, 'Qualification', $4, $5)
         RETURNING id`,
        [
          accountId,
          input.opportunityName,
          input.opportunityAmount ? Math.round(input.opportunityAmount * 100) : null,
          input.closeDate || null,
          input.userId,
        ],
      );
      opportunityId = oppResult.rows[0].id;
    }

    // Update lead as converted
    await client.query(
      `UPDATE leads
       SET status = 'Converted',
           converted_account_id = $1,
           converted_contact_id = $2,
           converted_opportunity_id = $3,
           converted_at = NOW(),
           updated_at = NOW()
       WHERE id = $4`,
      [accountId, contactId, opportunityId, input.leadId],
    );

    await client.query('COMMIT');

    logger.info({ leadId: input.leadId, accountId, contactId, opportunityId }, 'Lead converted');

    return { accountId, contactId, opportunityId };
  } catch (err) {
    await client.query('ROLLBACK');
    logger.error({ err, leadId: input.leadId }, 'Lead conversion failed');
    throw err;
  } finally {
    client.release();
  }
}
