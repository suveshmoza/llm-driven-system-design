/**
 * Database seeder for development
 * @module db/seed
 */
import pg from 'pg'
import { v4 as uuidv4 } from 'uuid'

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/sheets',
})

async function seed(): Promise<void> {
  console.log('Seeding database...')

  try {
    // Create demo users
    const aliceSessionId = uuidv4()
    const bobSessionId = uuidv4()

    const userResult = await pool.query(`
      INSERT INTO users (session_id, name, color)
      VALUES
        ($1, 'Alice', '#4ECDC4'),
        ($2, 'Bob', '#FF6B6B')
      ON CONFLICT (session_id) DO NOTHING
      RETURNING id, name
    `, [aliceSessionId, bobSessionId])

    if (userResult.rows.length === 0) {
      console.log('Users already exist, skipping seed')
      await pool.end()
      return
    }

    const alice = userResult.rows.find(u => u.name === 'Alice')
    const bob = userResult.rows.find(u => u.name === 'Bob')

    console.log('Created users:', alice?.name, bob?.name)

    // Create sample spreadsheets
    const spreadsheetResult = await pool.query(`
      INSERT INTO spreadsheets (title, owner_id)
      VALUES
        ('Q1 Budget 2024', $1),
        ('Project Timeline', $1),
        ('Team Directory', $2)
      RETURNING id, title, owner_id
    `, [alice?.id, bob?.id])

    console.log('Created spreadsheets:', spreadsheetResult.rows.map(s => s.title))

    const budgetSpreadsheet = spreadsheetResult.rows[0]
    const timelineSpreadsheet = spreadsheetResult.rows[1]
    const directorySpreadsheet = spreadsheetResult.rows[2]

    // Create sheets for each spreadsheet
    const sheetResult = await pool.query(`
      INSERT INTO sheets (spreadsheet_id, name, sheet_index)
      VALUES
        ($1, 'Summary', 0),
        ($1, 'Details', 1),
        ($2, 'Milestones', 0),
        ($2, 'Tasks', 1),
        ($3, 'Employees', 0)
      RETURNING id, name, spreadsheet_id
    `, [budgetSpreadsheet.id, timelineSpreadsheet.id, directorySpreadsheet.id])

    const summarySheet = sheetResult.rows.find(s => s.name === 'Summary')
    const employeesSheet = sheetResult.rows.find(s => s.name === 'Employees')

    // Add sample cells to the Summary sheet
    await pool.query(`
      INSERT INTO cells (sheet_id, row_index, col_index, raw_value, computed_value, format, updated_by)
      VALUES
        -- Header row
        ($1, 0, 0, 'Category', 'Category', '{"bold": true, "bgColor": "#E5E7EB"}', $2),
        ($1, 0, 1, 'Q1', 'Q1', '{"bold": true, "bgColor": "#E5E7EB"}', $2),
        ($1, 0, 2, 'Q2', 'Q2', '{"bold": true, "bgColor": "#E5E7EB"}', $2),
        ($1, 0, 3, 'Q3', 'Q3', '{"bold": true, "bgColor": "#E5E7EB"}', $2),
        ($1, 0, 4, 'Q4', 'Q4', '{"bold": true, "bgColor": "#E5E7EB"}', $2),
        ($1, 0, 5, 'Total', 'Total', '{"bold": true, "bgColor": "#E5E7EB"}', $2),
        -- Data rows
        ($1, 1, 0, 'Revenue', 'Revenue', '{}', $2),
        ($1, 1, 1, '125000', '125000', '{}', $2),
        ($1, 1, 2, '142000', '142000', '{}', $2),
        ($1, 1, 3, '165000', '165000', '{}', $2),
        ($1, 1, 4, '180000', '180000', '{}', $2),
        ($1, 1, 5, '=SUM(B2:E2)', '612000', '{"bold": true}', $2),
        ($1, 2, 0, 'Expenses', 'Expenses', '{}', $2),
        ($1, 2, 1, '95000', '95000', '{}', $2),
        ($1, 2, 2, '98000', '98000', '{}', $2),
        ($1, 2, 3, '102000', '102000', '{}', $2),
        ($1, 2, 4, '110000', '110000', '{}', $2),
        ($1, 2, 5, '=SUM(B3:E3)', '405000', '{"bold": true}', $2),
        ($1, 3, 0, 'Profit', 'Profit', '{"bold": true}', $2),
        ($1, 3, 1, '=B2-B3', '30000', '{"color": "#059669"}', $2),
        ($1, 3, 2, '=C2-C3', '44000', '{"color": "#059669"}', $2),
        ($1, 3, 3, '=D2-D3', '63000', '{"color": "#059669"}', $2),
        ($1, 3, 4, '=E2-E3', '70000', '{"color": "#059669"}', $2),
        ($1, 3, 5, '=SUM(B4:E4)', '207000', '{"bold": true, "color": "#059669"}', $2)
    `, [summarySheet?.id, alice?.id])

    // Add sample cells to the Employees sheet
    await pool.query(`
      INSERT INTO cells (sheet_id, row_index, col_index, raw_value, computed_value, format, updated_by)
      VALUES
        -- Header row
        ($1, 0, 0, 'Name', 'Name', '{"bold": true, "bgColor": "#DBEAFE"}', $2),
        ($1, 0, 1, 'Department', 'Department', '{"bold": true, "bgColor": "#DBEAFE"}', $2),
        ($1, 0, 2, 'Email', 'Email', '{"bold": true, "bgColor": "#DBEAFE"}', $2),
        ($1, 0, 3, 'Start Date', 'Start Date', '{"bold": true, "bgColor": "#DBEAFE"}', $2),
        -- Employee data
        ($1, 1, 0, 'Alice Johnson', 'Alice Johnson', '{}', $2),
        ($1, 1, 1, 'Engineering', 'Engineering', '{}', $2),
        ($1, 1, 2, 'alice@company.com', 'alice@company.com', '{}', $2),
        ($1, 1, 3, '2022-01-15', '2022-01-15', '{}', $2),
        ($1, 2, 0, 'Bob Smith', 'Bob Smith', '{}', $2),
        ($1, 2, 1, 'Marketing', 'Marketing', '{}', $2),
        ($1, 2, 2, 'bob@company.com', 'bob@company.com', '{}', $2),
        ($1, 2, 3, '2021-06-01', '2021-06-01', '{}', $2),
        ($1, 3, 0, 'Carol Williams', 'Carol Williams', '{}', $2),
        ($1, 3, 1, 'Engineering', 'Engineering', '{}', $2),
        ($1, 3, 2, 'carol@company.com', 'carol@company.com', '{}', $2),
        ($1, 3, 3, '2023-03-10', '2023-03-10', '{}', $2),
        ($1, 4, 0, 'David Brown', 'David Brown', '{}', $2),
        ($1, 4, 1, 'Sales', 'Sales', '{}', $2),
        ($1, 4, 2, 'david@company.com', 'david@company.com', '{}', $2),
        ($1, 4, 3, '2020-11-20', '2020-11-20', '{}', $2)
    `, [employeesSheet?.id, bob?.id])

    console.log('Added sample cells to sheets')
    console.log('Seed complete')
    console.log('')
    console.log('Demo session IDs (use in browser to see spreadsheets):')
    console.log(`  Alice: ${aliceSessionId}`)
    console.log(`  Bob: ${bobSessionId}`)
  } catch (error) {
    console.error('Seed failed:', error)
    process.exit(1)
  } finally {
    await pool.end()
  }
}

seed()
