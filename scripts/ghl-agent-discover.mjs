// Discovery — list ALL agents in the location, dump each full config, and for
// any agent with an llmVersionId, dump its Agent Studio flow version (nodes).
// Read-only. Run: node --env-file=.env scripts/ghl-agent-discover.mjs

import { writeFileSync, mkdirSync } from 'node:fs'

const BASE = (process.env.GHL_API_BASE || 'https://services.leadconnectorhq.com').replace(/\/$/, '')
const LOC = process.env.GHL_LOCATION_ID
const TOKEN = process.env.GHL_PIT_WRITE_TOKEN || process.env.GHL_PIT_TOKEN
const OUT = process.env.OUT_DIR || '/tmp/claude-1000/-home-shivam-Work-tries-highlevel-agent-monitor/7fb70e8e-b3c9-4455-969a-48a1fd8e37ee/scratchpad/agent-dump'
mkdirSync(OUT, { recursive: true })

const H = { Authorization: `Bearer ${TOKEN}`, Version: 'v3', Accept: 'application/json' }
async function get(path) {
  const url = `${BASE}/${path.replace(/^\//, '')}?locationId=${encodeURIComponent(LOC)}`
  const res = await fetch(url, { headers: H })
  const text = await res.text()
  let json; try { json = JSON.parse(text) } catch { json = null }
  return { status: res.status, ok: res.ok, json, text }
}
const unwrap = (j) => j?.agent ?? j?.data ?? j

const list = await get('voice-ai/agents')
console.log(`LIST voice-ai/agents -> ${list.status}`)
if (!list.ok) { console.log(list.text.slice(0, 400)); process.exit(1) }
const agents = (list.json?.agents ?? []).map(a => ({ id: a.id, agentName: a.agentName, agentType: a.agentType }))
console.log(`Found ${agents.length} agent(s):`)
for (const a of agents) console.log(`  - ${a.id}  ${JSON.stringify(a.agentName)}  type=${a.agentType}`)

for (const a of agents) {
  const r = await get(`voice-ai/agents/${a.id}`)
  const ag = unwrap(r.json)
  writeFileSync(`${OUT}/agent-${a.id}.json`, JSON.stringify(ag, null, 2))
  console.log(`\n=== ${JSON.stringify(ag.agentName)} (${ag.agentType}) ===`)
  console.log(`  top-level keys: ${Object.keys(ag).join(', ')}`)
  console.log(`  agentPrompt.len=${(ag.agentPrompt||'').length}  welcomeMessage=${JSON.stringify((ag.welcomeMessage||'').slice(0,60))}`)
  console.log(`  llmVersionId=${ag.llmVersionId}  customLlmUrl=${ag.customLlmUrl ? 'set' : 'none'}`)
  console.log(`  actions=${JSON.stringify(ag.actions)?.slice(0,120)}  prompts=${JSON.stringify(ag.prompts)?.slice(0,120)}`)

  if (ag.llmVersionId) {
    const fv = await get(`agent-studio/agents/versions/${ag.llmVersionId}`)
    if (fv.ok) {
      const ver = fv.json?.version ?? fv.json
      writeFileSync(`${OUT}/flowversion-${ag.id}.json`, JSON.stringify(ver, null, 2))
      const nodes = ver?.nodes ?? []
      console.log(`  flow version: state=${ver?.state} isPublished=${ver?.isPublished} nodes=${nodes.length} edges=${(ver?.edges||[]).length}`)
      for (const n of nodes) {
        const cfgKeys = n.nodeConfig ? Object.keys(n.nodeConfig) : []
        // surface any free-text instruction-ish fields on the node
        const instr = n.nodeConfig?.prompt ?? n.nodeConfig?.instruction ?? n.nodeConfig?.instructions ?? n.nodeConfig?.description ?? n.nodeConfig?.message
        console.log(`    · node ${n.nodeId} [${n.nodeType}/${n.frontendNodeType}] "${n.nodeDisplayName}" cfgKeys=[${cfgKeys.join(',')}]${instr ? ` instr="${String(instr).slice(0,80)}"` : ''}`)
      }
    } else {
      console.log(`  flow version GET -> ${fv.status} (${fv.text.slice(0,120)})`)
    }
  }
}
console.log(`\nDumps written to ${OUT}/`)
