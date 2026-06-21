import { seed } from '../data/seed'

/**
 * POST /api/seed — load the seeded agents / calls / transcripts into storage.
 * Idempotent (upsert by stable id). Returns the counts written.
 */
export default defineEventHandler(async () => {
  const { agents, calls } = await seed()
  return { agents, calls }
})
