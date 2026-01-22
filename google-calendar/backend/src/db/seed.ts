import bcrypt from 'bcryptjs'
import { pool } from '../shared/db.js'

async function seed() {
  try {
    // Create test users
    const passwordHash = await bcrypt.hash('password123', 10)

    const userResult = await pool.query(`
      INSERT INTO users (username, email, password_hash, timezone)
      VALUES
        ('alice', 'alice@example.com', $1, 'America/New_York'),
        ('bob', 'bob@example.com', $1, 'America/Los_Angeles')
      ON CONFLICT (username) DO NOTHING
      RETURNING id, username
    `, [passwordHash])

    if (userResult.rows.length === 0) {
      console.log('Users already exist, skipping seed')
      await pool.end()
      return
    }

    const alice = userResult.rows.find(u => u.username === 'alice')
    const bob = userResult.rows.find(u => u.username === 'bob')

    // Create calendars for Alice
    const calendarResult = await pool.query(`
      INSERT INTO calendars (user_id, name, color, is_primary)
      VALUES
        ($1, 'Personal', '#3B82F6', true),
        ($1, 'Work', '#EF4444', false),
        ($2, 'Personal', '#10B981', true)
      RETURNING id, name, user_id
    `, [alice?.id, bob?.id])

    const alicePersonal = calendarResult.rows.find(c => c.user_id === alice?.id && c.name === 'Personal')
    const aliceWork = calendarResult.rows.find(c => c.user_id === alice?.id && c.name === 'Work')

    // Create sample events for Alice
    const now = new Date()
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())

    await pool.query(`
      INSERT INTO events (calendar_id, title, description, location, start_time, end_time, all_day, color)
      VALUES
        -- Today's events
        ($1, 'Team Standup', 'Daily sync meeting', 'Zoom', $3::date + interval '9 hours', $3::date + interval '9 hours 30 minutes', false, null),
        ($1, 'Lunch with Sarah', null, 'Cafe downtown', $3::date + interval '12 hours', $3::date + interval '13 hours', false, null),
        ($2, 'Project Review', 'Q1 project review', 'Conference Room A', $3::date + interval '14 hours', $3::date + interval '15 hours 30 minutes', false, null),

        -- Tomorrow's events
        ($1, 'Morning Yoga', null, 'Gym', $3::date + interval '1 day 7 hours', $3::date + interval '1 day 8 hours', false, '#8B5CF6'),
        ($2, 'Client Call', 'Demo for new client', 'Phone', $3::date + interval '1 day 10 hours', $3::date + interval '1 day 11 hours', false, null),

        -- All day event
        ($1, 'Team Offsite', 'Annual team building', 'Lake Resort', $3::date + interval '3 days', $3::date + interval '4 days', true, '#F59E0B'),

        -- Next week
        ($2, 'Quarterly Planning', 'Planning for Q2', 'Main Office', $3::date + interval '7 days 9 hours', $3::date + interval '7 days 17 hours', false, null)
    `, [alicePersonal?.id, aliceWork?.id, today])

    console.log('Database seeded successfully')
    console.log('Test accounts:')
    console.log('  alice / password123')
    console.log('  bob / password123')
  } catch (error) {
    console.error('Seed failed:', error)
    process.exit(1)
  } finally {
    await pool.end()
  }
}

seed()
