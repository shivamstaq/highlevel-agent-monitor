/**
 * POST /api/dev/reindex (DEV ONLY) — rebuild the write-time entity indexes
 * (index:agents / index:calls / index:fleet) from a full key scan. Needed when a
 * data store was populated out-of-band (e.g. seed files copied in) so the indexes
 * the dashboard hot-read path depends on were never written. 404s in production.
 */
import { reindexAll } from '../../services/db'

export default defineEventHandler(async () => {
  if (!import.meta.dev) {
    throw createError({ statusCode: 404, statusMessage: 'Not found' })
  }
  return await reindexAll()
})
