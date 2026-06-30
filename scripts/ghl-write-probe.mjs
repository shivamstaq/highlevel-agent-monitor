// Phase 0 contract probe — confirms the GHL Voice AI agent WRITE contract.
// Safe by default: reads the agent, then does a NO-OP PATCH (echoes the current
// welcomeMessage back). Pass `--mutate` to do a real round-trip (change + restore).
// Run: node --env-file=.env scripts/ghl-write-probe.mjs [--mutate]

const BASE = (process.env.GHL_API_BASE || 'https://services.leadconnectorhq.com').replace(/\/$/, '')
const LOC = process.env.GHL_LOCATION_ID
const TOKEN = process.env.GHL_PIT_WRITE_TOKEN
const AGENT_ID = process.env.PROBE_AGENT_ID || '6a390f5c153058cb6ac6207d'
const MUTATE = process.argv.includes('--mutate')

if (!TOKEN) { console.error('Missing GHL_PIT_WRITE_TOKEN'); process.exit(1) }
if (!LOC) { console.error('Missing GHL_LOCATION_ID'); process.exit(1) }

const H = { Authorization: `Bearer ${TOKEN}`, Version: 'v3', Accept: 'application/json' }

async function req(method, path, body) {
  const url = `${BASE}/${path.replace(/^\//, '')}?locationId=${encodeURIComponent(LOC)}`
  const init = { method, headers: { ...H } }
  if (body !== undefined) { init.headers['Content-Type'] = 'application/json'; init.body = JSON.stringify(body) }
  const res = await fetch(url, init)
  const text = await res.text()
  let json; try { json = JSON.parse(text) } catch { json = null }
  return { status: res.status, ok: res.ok, json, text }
}

function unwrap(j) { return j?.agent ?? j?.data ?? j }

console.log(`BASE=${BASE}\nLOC=${LOC}\nAGENT_ID=${AGENT_ID}\nMUTATE=${MUTATE}\n`)

// STEP 1 — read with the write token
const r1 = await req('GET', `voice-ai/agents/${AGENT_ID}`)
console.log(`[1] GET agent -> ${r1.status}`)
if (!r1.ok) { console.log('    body:', r1.text.slice(0, 400)); process.exit(1) }
const agent = unwrap(r1.json)
const origWelcome = agent.welcomeMessage
console.log(`    agentName=${JSON.stringify(agent.agentName)} agentType=${agent.agentType}`)
console.log(`    welcomeMessage=${JSON.stringify(origWelcome)}`)
console.log(`    agentPrompt.len=${(agent.agentPrompt||'').length} llmVersionId=${agent.llmVersionId}`)

// STEP 2 — NO-OP PATCH (echo current welcomeMessage). Try PATCH, fall back to PUT.
console.log(`\n[2] no-op write (echo welcomeMessage)`)
for (const method of ['PATCH', 'PUT']) {
  const r = await req(method, `voice-ai/agents/${AGENT_ID}`, { welcomeMessage: origWelcome })
  console.log(`    ${method} -> ${r.status}${r.ok ? ' OK' : ''}`)
  if (!r.ok) console.log(`      body: ${r.text.slice(0, 300)}`)
  if (r.ok) { console.log(`    => WRITE METHOD = ${method}; partial body accepted.`); break }
}

// STEP 2b — NO-OP echo of agentPrompt (the big field) to confirm it's writable.
console.log(`\n[2b] no-op write (echo agentPrompt, len=${(agent.agentPrompt||'').length})`)
const rp = await req('PATCH', `voice-ai/agents/${AGENT_ID}`, { agentPrompt: agent.agentPrompt })
console.log(`    PATCH agentPrompt -> ${rp.status}${rp.ok ? ' OK (agentPrompt is writable)' : ''}`)
if (!rp.ok) console.log(`      body: ${rp.text.slice(0, 300)}`)

if (!MUTATE) {
  console.log('\n[3] skipped real round-trip (pass --mutate to run change+restore).')
  process.exit(0)
}

// STEP 3 — real round-trip: change welcomeMessage, verify, restore.
const probeVal = `${origWelcome} [probe ok]`
console.log(`\n[3] real round-trip`)
const w = await req('PATCH', `voice-ai/agents/${AGENT_ID}`, { welcomeMessage: probeVal })
console.log(`    PATCH change -> ${w.status}`)
const v = await req('GET', `voice-ai/agents/${AGENT_ID}`)
const after = unwrap(v.json)
console.log(`    GET welcomeMessage=${JSON.stringify(after.welcomeMessage)} (persisted=${after.welcomeMessage === probeVal})`)
console.log(`    llmVersionId before=${agent.llmVersionId} after=${after.llmVersionId} (bumped=${agent.llmVersionId !== after.llmVersionId})`)
const back = await req('PATCH', `voice-ai/agents/${AGENT_ID}`, { welcomeMessage: origWelcome })
console.log(`    PATCH restore -> ${back.status}`)
const fin = await req('GET', `voice-ai/agents/${AGENT_ID}`)
console.log(`    restored welcomeMessage=${JSON.stringify(unwrap(fin.json).welcomeMessage)} (ok=${unwrap(fin.json).welcomeMessage === origWelcome})`)
