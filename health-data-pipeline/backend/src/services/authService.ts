import { db } from '../config/database.js';
import { redis } from '../config/redis.js';
import { v4 as uuidv4 } from 'uuid';
import bcrypt from 'bcrypt';

export interface User {
  id: string;
  email: string;
  name: string;
  role: 'user' | 'admin';
  created_at: Date;
}

interface Session {
  token: string;
  expiresAt: Date;
}

export class AuthService {
  async register(email: string, password: string, name: string): Promise<{ user: User; session: Session }> {
    // Check if user exists
    const existing = await db.query(
      'SELECT id FROM users WHERE email = $1',
      [email.toLowerCase()]
    );

    if (existing.rows.length > 0) {
      throw new Error('User already exists with this email');
    }

    const passwordHash = await bcrypt.hash(password, 10);

    const result = await db.query(
      `INSERT INTO users (email, password_hash, name)
       VALUES ($1, $2, $3)
       RETURNING id, email, name, role, created_at`,
      [email.toLowerCase(), passwordHash, name]
    );

    const user = result.rows[0] as User;
    const session = await this.createSession(user.id);

    return { user, session };
  }

  async login(email: string, password: string): Promise<{ user: User; session: Session }> {
    const result = await db.query(
      'SELECT id, email, name, role, password_hash FROM users WHERE email = $1',
      [email.toLowerCase()]
    );

    if (result.rows.length === 0) {
      throw new Error('Invalid email or password');
    }

    const user = result.rows[0] as User & { password_hash: string };
    const validPassword = await bcrypt.compare(password, user.password_hash);

    if (!validPassword) {
      throw new Error('Invalid email or password');
    }

    const session = await this.createSession(user.id);
    const { password_hash: _, ...userWithoutPassword } = user;

    return { user: userWithoutPassword, session };
  }

  async createSession(userId: string): Promise<Session> {
    const token = uuidv4();
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days

    await db.query(
      `INSERT INTO sessions (user_id, token, expires_at)
       VALUES ($1, $2, $3)`,
      [userId, token, expiresAt]
    );

    // Store session in Redis for fast lookup
    await redis.setex(
      `session:${token}`,
      7 * 24 * 60 * 60,
      JSON.stringify({ userId, expiresAt })
    );

    return { token, expiresAt };
  }

  async validateSession(token: string): Promise<string | null> {
    // Check Redis first
    const cached = await redis.get(`session:${token}`);

    if (cached) {
      const session = JSON.parse(cached);
      if (new Date(session.expiresAt) > new Date()) {
        return session.userId;
      }
    }

    // Fallback to database
    const result = await db.query(
      `SELECT user_id FROM sessions
       WHERE token = $1 AND expires_at > NOW()`,
      [token]
    );

    if (result.rows.length === 0) {
      return null;
    }

    return result.rows[0].user_id;
  }

  async logout(token: string): Promise<void> {
    await db.query('DELETE FROM sessions WHERE token = $1', [token]);
    await redis.del(`session:${token}`);
  }

  async getUser(userId: string): Promise<User | null> {
    const result = await db.query(
      'SELECT id, email, name, role, created_at FROM users WHERE id = $1',
      [userId]
    );

    return (result.rows[0] as User) || null;
  }
}

export const authService = new AuthService();
