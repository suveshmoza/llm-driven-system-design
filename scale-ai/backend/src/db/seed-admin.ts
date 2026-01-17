/**
 * Admin user seeder.
 * Creates a default admin user for initial system access.
 * Safe to run multiple times - skips if admin already exists.
 * @module db/seed-admin
 */

import bcrypt from 'bcrypt'
import { pool } from '../shared/db.js'

/**
 * Seeds the default admin user if one doesn't exist.
 * Creates user with email "admin@scaleai.local" and password "admin123".
 * WARNING: Change these credentials in production!
 */
async function seedAdminUser() {
  try {
    console.log('Creating admin user...')

    // Check if admin user already exists
    const existing = await pool.query(
      'SELECT id FROM admin_users WHERE email = $1',
      ['admin@scaleai.local']
    )

    if (existing.rows.length > 0) {
      console.log('Admin user already exists')
      process.exit(0)
    }

    // Create password hash
    const password = 'admin123'
    const passwordHash = await bcrypt.hash(password, 10)

    // Insert admin user
    await pool.query(
      'INSERT INTO admin_users (email, password_hash, name) VALUES ($1, $2, $3)',
      ['admin@scaleai.local', passwordHash, 'Default Admin']
    )

    console.log('Admin user created!')
    console.log('Email: admin@scaleai.local')
    console.log('Password: admin123')
    console.log('')
    console.log('IMPORTANT: Change this password in production!')

    process.exit(0)
  } catch (error) {
    console.error('Error seeding admin user:', error)
    process.exit(1)
  }
}

seedAdminUser()
