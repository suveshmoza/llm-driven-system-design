import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import { pool } from './db.js';
import { logger } from './logger.js';

/** Generates a 256-bit cryptographically random share token. */
export function generateShareToken(): string {
  return crypto.randomBytes(32).toString('hex');
}

/** Creates a share link for a video with optional password protection and expiration. */
export async function createShare(
  videoId: string,
  options: {
    password?: string;
    expiresAt?: string;
    allowDownload?: boolean;
  } = {},
): Promise<{ id: string; token: string; expiresAt: string | null; allowDownload: boolean }> {
  const token = generateShareToken();
  let passwordHash: string | null = null;

  if (options.password) {
    passwordHash = await bcrypt.hash(options.password, 10);
  }

  const result = await pool.query(
    `INSERT INTO shares (video_id, token, password_hash, expires_at, allow_download)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id, token, expires_at, allow_download`,
    [
      videoId,
      token,
      passwordHash,
      options.expiresAt || null,
      options.allowDownload || false,
    ],
  );

  const share = result.rows[0];
  return {
    id: share.id,
    token: share.token,
    expiresAt: share.expires_at,
    allowDownload: share.allow_download,
  };
}

/** Validates a share token, checking expiry and password, and returns the associated video ID. */
export async function validateShare(
  token: string,
  password?: string,
): Promise<{ valid: boolean; videoId?: string; allowDownload?: boolean; error?: string }> {
  try {
    const result = await pool.query(
      `SELECT s.*, v.id as vid, v.title, v.status, v.storage_path, v.duration_seconds, v.thumbnail_path,
              u.username, u.display_name, u.avatar_url
       FROM shares s
       JOIN videos v ON v.id = s.video_id
       JOIN users u ON u.id = v.user_id
       WHERE s.token = $1`,
      [token],
    );

    if (result.rows.length === 0) {
      return { valid: false, error: 'Share link not found' };
    }

    const share = result.rows[0];

    // Check expiry
    if (share.expires_at && new Date(share.expires_at) < new Date()) {
      return { valid: false, error: 'Share link has expired' };
    }

    // Check password
    if (share.password_hash) {
      if (!password) {
        return { valid: false, error: 'Password required' };
      }
      const validPassword = await bcrypt.compare(password, share.password_hash);
      if (!validPassword) {
        return { valid: false, error: 'Invalid password' };
      }
    }

    return {
      valid: true,
      videoId: share.video_id,
      allowDownload: share.allow_download,
    };
  } catch (err) {
    logger.error({ err, token }, 'Failed to validate share');
    throw err;
  }
}
