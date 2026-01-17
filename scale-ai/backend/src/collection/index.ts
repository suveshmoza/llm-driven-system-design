/**
 * Collection service entry point.
 * Handles drawing submissions from the drawing game frontend.
 * This service is designed to scale independently for high write throughput.
 * @module collection
 */

import { app } from './app.js'
import { ensureBuckets } from '../shared/storage.js'

/** Port for the collection service (default: 3001) */
const PORT = parseInt(process.env.PORT || '3001')

/**
 * Starts the collection service.
 * Ensures MinIO buckets exist before accepting requests.
 */
async function start() {
  try {
    // Ensure MinIO buckets exist
    await ensureBuckets()

    app.listen(PORT, () => {
      console.log(`Collection service running on http://localhost:${PORT}`)
    })
  } catch (error) {
    console.error('Failed to start collection service:', error)
    process.exit(1)
  }
}

start()
