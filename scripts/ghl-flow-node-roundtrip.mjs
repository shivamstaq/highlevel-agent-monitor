// Phase 0 (node-flow) — confirm a NODE PROMPT can be edited via the version PATCH.
// Backs up the full version to disk, echoes nodes (no-op), then change+restore the
// llmNode prompt. Pass --mutate to do the real round-trip. Run:
//   node --env-file=.env scripts/ghl-flow-node-roundtrip.mjs [--mutate]
import { writeFileSync } from 'node:fs'

const BASE = (process.env.GHL_API_BASE || 'https://services.leadconnectorhq.com').replace(/\/$/, '')
const LOC = process.env.GHL_LOCATION_ID
const TOKEN = process.env.GHL_PIT_WRITE_TOKEN
const AGENT_ID = '6a390f5c153058cb6ac6207d'
const LLM_NODE = '6a54f2c3-6a13-434a-a7f9-9fc69d34a8d9'
const MUTATE = process.argv.includes('--mutate')
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
const getVer = async (vid) => (await req('GET', `agent-studio/agents/versions/${vid}`)).json.version

const VID = (await req('GET', `voice-ai/agents/${AGENT_ID}`)).json.llmVersionId
const ver = await getVer(VID)
const backup = `/tmp/claude-1000/-home-shivam-Work-tries-highlevel-agent-monitor/7fb70e8e-b3c9-4455-969a-48a1fd8e37ee/scratchpad/version-backup-${VID}.json`
writeFileSync(backup, JSON.stringify(ver, null, 2))
console.log(`versionId=${VID}  nodes=${ver.nodes.length}  backup -> ${backup}`)

const origNodes = ver.nodes
const llm = origNodes.find(n => n.nodeId === LLM_NODE)
const origPrompt = llm.nodeConfig.prompt
console.log(`llmNode prompt.len=${origPrompt.length}  head="${origPrompt.slice(0, 50)}…"`)

// 1) echo full nodes unchanged (no-op) — confirms `nodes` is an accepted write field
const echo = await req('PATCH', `agent-studio/agents/versions/${VID}`, { nodes: origNodes })
console.log(`\n[1] PATCH { nodes: <unchanged> } -> ${echo.status}  ${echo.ok ? 'OK (nodes is writable)' : echo.text.slice(0,200)}`)

if (!MUTATE) { console.log('\n[2] skipped real round-trip (pass --mutate).'); process.exit(0) }

// 2) real round-trip: change llmNode prompt, verify, restore
const probePrompt = origPrompt + ' [probe ok]'
const modNodes = origNodes.map(n => n.nodeId === LLM_NODE
  ? { ...n, nodeConfig: { ...n.nodeConfig, prompt: probePrompt } } : n)
const w = await req('PATCH', `agent-studio/agents/versions/${VID}`, { nodes: modNodes })
console.log(`\n[2] PATCH change llmNode.prompt -> ${w.status}`)
const after = await getVer(VID)
const afterPrompt = after.nodes.find(n => n.nodeId === LLM_NODE).nodeConfig.prompt
console.log(`    persisted=${afterPrompt === probePrompt}  state=${after.state} isPublished=${after.isPublished}`)
console.log(`    nodes still=${after.nodes.length}  other nodes intact=${after.nodes.length === origNodes.length}`)
// restore
const back = await req('PATCH', `agent-studio/agents/versions/${VID}`, { nodes: origNodes })
const fin = await getVer(VID)
const finPrompt = fin.nodes.find(n => n.nodeId === LLM_NODE).nodeConfig.prompt
console.log(`    restore -> ${back.status}  restored=${finPrompt === origPrompt}`)
