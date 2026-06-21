import fsDriver from 'unstorage/drivers/fs'

/**
 * Mount the `data` storage namespace to a gitignored `.data/` directory using
 * the unstorage filesystem driver. This gives the whole app durable, native-dep-free
 * persistence for agents / calls / transcripts / analyses (keyspace defined in SPEC.json).
 */
export default defineNitroPlugin(async () => {
  const storage = useStorage()
  const base = process.env.DATA_DIR || '.data'

  // Nitro reserves a default `data:` mount (in-memory). Replace it with the
  // durable fs driver so agents/calls/transcripts/analyses survive restarts.
  if (storage.getMounts().some(m => m.base === 'data:')) {
    await storage.unmount('data')
  }
  storage.mount('data', fsDriver({ base }))
})
