// Phase 0 (node-flow) — discover the Agent Studio version UPDATE endpoint SAFELY.
// Strategy: echo current values (no behavioral change). Does NOT publish.
// Run: node --env-file=.env scripts/ghl-flow-write-probe.mjs

const BASE = (process.env.GHL_API_BASE || 'https://services.leadconnectorhq.com').replace(/\/$/, '')
const LOC = process.env.GHL_LOCATION_ID
const TOKEN = process.env.GHL_PIT_WRITE_TOKEN
const AGENT_ID = '6a390f5c153058cb6ac6207d'

const H = { Authorization: `Bearer ${TOKEN}`, Version: 'v3', Accept: 'application/json' }
async function req(method, path, body) {
  const url = `${BASE}/${path.replace(/^\//, '')}?locationId=${encodeURIComponent(LOC)}`
  const init = { method, headers: { ...H } }
  if (body !== undefined) { init.headers['Content-Type'] = 'application/json'; init.body = JSON.stringify(body) }
  let res
  try { res = await fetch(url, init) } catch (e) { return { status: 0, ok: false, text: String(e) } }
  const text = await res.text()
  return { status: res.status, ok: res.ok, text }
}

// 1) read current version
const VID = (await (async () => {
  const r = await req('GET', `voice-ai/agents/${AGENT_ID}`)
  return JSON.parse(r.text).llmVersionId
})())
console.log(`versionId=${VID}`)
const vget = await req('GET', `agent-studio/agents/versions/${VID}`)
const ver = JSON.parse(vget.text).version
console.log(`current: state=${ver.state} isPublished=${ver.isPublished} versionName=${JSON.stringify(ver.versionName)} nodes=${ver.nodes.length}\n`)

// 2) probe UPDATE endpoints with SAFE no-op echo bodies (current values only)
const metaEcho = { versionName: ver.versionName, description: ver.description ?? '' }
const candidates = [
  ['PATCH', `agent-studio/agents/versions/${VID}`, metaEcho],
  ['PUT',   `agent-studio/agents/versions/${VID}`, metaEcho],
  ['PATCH', `agent-studio/agents/${AGENT_ID}/versions/${VID}`, metaEcho],
  ['PUT',   `agent-studio/agents/${AGENT_ID}/versions/${VID}`, metaEcho],
  ['PATCH', `agent-studio/agents/${AGENT_ID}`, metaEcho],
]
console.log('— metadata no-op echo probes —')
let updatePath = null
for (const [m, p, b] of candidates) {
  const r = await req(m, p, b)
  console.log(`  ${m} ${p} -> ${r.status}  ${r.ok ? 'OK' : r.text.slice(0, 160)}`)
  if (r.ok && !updatePath) updatePath = [m, p]
}

// 3) probe PUBLISH endpoint EXISTENCE only — send no body, observe (do not rely on success)
console.log('\n— publish endpoint discovery (NOT executing a real publish; observing only) —')
for (const p of [
  `agent-studio/agents/versions/${VID}/publish`,
  `agent-studio/agents/${AGENT_ID}/versions/${VID}/publish`,
  `agent-studio/agents/${AGENT_ID}/publish`,
  `agent-studio/agents/versions/${VID}/promote`,
]) {
  // GET to see if the route exists (405 method-not-allowed = route exists, POST needed)
  const r = await req('GET', p)
  console.log(`  GET ${p} -> ${r.status}  ${r.text.slice(0, 120)}`)
}

console.log(`\nDISCOVERED UPDATE: ${updatePath ? updatePath.join(' ') : 'none of the candidates accepted a metadata echo'}`)
