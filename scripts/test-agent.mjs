import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const upstream = 'D:/topview-3d-builder'
const source = `${upstream}/packages/builder/src`
const req = createRequire(`${upstream}/package.json`)
const { build } = createRequire(req.resolve('tsup'))('esbuild')
const { outputFiles } = await build({ stdin: { contents: 'export * from "./editor-src/agent"; export * from "./editor-src/host"; export * from "./editor-src/agent-tools"', resolveDir: root, loader: 'ts' }, bundle: true, platform: 'node', format: 'esm', write: false, nodePaths: [`${upstream}/packages/builder/node_modules`, `${upstream}/node_modules`], alias: { '@topview/3d-builder/evaluate': `${source}/evaluate/index.ts` } })
globalThis.location = { href: 'http://localhost:8188/topview3d/editor/index.html', origin: 'http://localhost:8188' }
globalThis.parent = { postMessage() {} }
globalThis.localStorage = { getItem: () => 'a'.repeat(64) }
const { createHost, createAgent, executeSceneTool } = await import(`data:text/javascript;base64,${Buffer.from(outputFiles[0].contents).toString('base64')}`)
const workflow = JSON.parse(fs.readFileSync(path.join(root, 'examples/topview-3d-preview.json'), 'utf8'))
const node = workflow.nodes.find(n => n.type === 'Topview3DScene')
const initial = JSON.parse(node.properties?.topview_scene_state || node.widgets_values.find(v => typeof v === 'string' && v.startsWith('{')))
const host = createHost(async () => {})
host.state = structuredClone(initial)
host.assets = JSON.parse(fs.readFileSync(path.join(root, 'assets/manifest.json'), 'utf8')).assets
const added = await executeSceneTool('add_primitive', { name: 'test', shape: 'box', position: { x: 1, y: 0, z: 0 } }, host.state, host, null)
assert.equal(host.state.document.content.nodes.length, initial.document.content.nodes.length)
assert.equal(added.state.document.content.nodes.length, initial.document.content.nodes.length + 1)
const keyed = await executeSceneTool('set_keyframe', { node_id: added.result.node_id, property: 'position', frame: 0, value: [1, 0, 0], interpolation: 'linear' }, added.state, host, null)
assert.ok(keyed.state.fcurves)
await assert.rejects(executeSceneTool('set_transform', { node_id: added.result.node_id, position: { x: 2, y: 0, z: 0 } }, keyed.state, host, null), /animation keys/)
await assert.rejects(executeSceneTool('add_primitive', { name: 'bad', shape: 'box', position: { x: 0, y: 0, z: 0 }, scale: { x: -1, y: 1, z: 1 } }, host.state, host, null), /positive/)
let calls = 0, fail = false, cancel = false
let agent
globalThis.fetch = async (url, options) => {
  if (String(url).endsWith('/config')) return Response.json({ profiles: [{ id: 'qwen', model: 'test-model', name: 'Qwen', has_key: true }], active_id: 'qwen' })
  calls++
  if (calls === 1) return Response.json({ message: { role: 'assistant', content: null, tool_calls: [{ id: 'tool1', type: 'function', function: { name: 'add_primitive', arguments: JSON.stringify({ name: 'Agent box', shape: 'box', position: { x: 0, y: 1, z: 0 } }) } }] }, finish_reason: 'tool_calls' })
  assert.equal(JSON.parse(options.body).messages.at(-1).role, 'tool')
  if (fail) return Response.json({ error: 'Mock provider failure' }, { status: 502 })
  if (cancel) await agent.adapter.stop('comfyui', 'test')
  return Response.json({ message: { role: 'assistant', content: 'Done' }, finish_reason: 'stop' })
}
const api = { agent: { locked: false }, session: { userKeysEnabled: initial.userKeysEnabled, async flushPendingUserWrites() {}, async save() {}, async reloadFromHost() {} } }
agent = createAgent(host, () => api)
for (const mode of ['success', 'failure', 'cancel']) {
  calls = 0; fail = mode === 'failure'; cancel = mode === 'cancel'; host.state = structuredClone(initial)
  const events = []
  await agent.adapter.send('comfyui', { text: 'Add a box', context: {} }, e => events.push(e))
  assert.equal(events.at(-1).status, mode === 'success' ? 'succeeded' : mode === 'failure' ? 'failed' : 'cancelled')
  assert.equal(host.state.document.content.nodes.length, initial.document.content.nodes.length + (mode === 'success' ? 1 : 0))
  const restored = createAgent(host, () => api)
  const restoredHistory = await restored.adapter.loadHistory('comfyui')
  assert.equal(restoredHistory.length,2)
  assert.equal(restoredHistory[0].content,'Add a box')
  const reopened = createHost(async () => {})
  reopened.state = JSON.parse(JSON.stringify(host.state))
  assert.deepEqual(await createAgent(reopened,()=>api).adapter.loadHistory('comfyui'),restoredHistory)
  restoredHistory[0].content = 'mutated'
  assert.equal(host.state.agentHistory[0].content,'Add a box')
  if (mode === 'success') { await agent.undo(); assert.deepEqual(host.state.document, initial.document); assert.equal(host.state.agentHistory[1].content,'Done') }
}
console.log('Agent checks passed: tool validation, keyframes, multi-step calls, atomic commit, undo, failure and cancellation rollback.')
let opened = 0
const missingKeyAgent = createAgent(host, () => api, () => { opened++ })
for (const profiles of [[], [{ id: 'qwen', model: 'test-model', has_key: false }]]) {
  globalThis.fetch = async url => {
    assert.ok(String(url).endsWith('/config'), 'Missing keys must not call the model')
    return Response.json({ profiles, active_id: 'qwen' })
  }
  const events = []
  await missingKeyAgent.adapter.send('comfyui', { text: 'Add a box', context: {} }, e => events.push(e))
  assert.equal(events.at(-1).status, 'failed')
  assert.deepEqual(host.state.document, initial.document)
}
assert.equal(opened, 2)
console.log('Missing profile/key opens API settings without a model call or scene change.')

// A long turn must finish normally beyond the former round and batch limits.
host.state = structuredClone(initial)
let rounds = 0
globalThis.fetch = async url => {
  if (String(url).endsWith('/config')) return Response.json({profiles:[{id:'qwen',model:'test-model',has_key:true}],active_id:'qwen'})
  rounds++
  return Response.json({message: rounds <= 15 ? {role:'assistant',content:null,tool_calls:Array.from({length:17},(_,i)=>({id:`call-${rounds}-${i}`,type:'function',function:{name:'read_scene',arguments:'{}'}}))} : {role:'assistant',content:'Long task complete'},finish_reason:rounds<=15?'tool_calls':'stop'})
}
const longEvents=[]
await agent.adapter.send('comfyui',{text:'Long task',context:{}},e=>longEvents.push(e))
assert.equal(rounds,16)
assert.equal(longEvents.at(-1).status,'succeeded')
assert.equal(host.state.agentHistory.at(-1).content,'Long task complete')
console.log('Long turns pass beyond 12 rounds and 16 tool calls per response.')

const baseline = structuredClone(initial)
const batch = await executeSceneTool('batch_edit',{operations:[
  {tool:'add_primitive',arguments:{name:'Seat',shape:'box',position:{x:0,y:.4,z:0},scale:{x:1,y:.2,z:1}}},
  {tool:'add_primitive',arguments:{name:'Back',shape:'box',position:{x:0,y:.8,z:.45},scale:{x:1,y:.8,z:.1}}}
]},baseline,host,null)
assert.equal(batch.state.document.content.nodes.length,baseline.document.content.nodes.length+2)
const inspected=await executeSceneTool('inspect_scene',{},batch.state,host,null)
const seat=inspected.result.measurements.find(n=>n.name==='Seat')
assert.equal(seat.topY,.5)
assert.deepEqual(seat.size,[1,.2,1])
assert.equal(inspected.result.visualVerified,false)
const snapshot=JSON.stringify(baseline)
await assert.rejects(executeSceneTool('batch_edit',{operations:[
 {tool:'add_primitive',arguments:{name:'Transient',shape:'box',position:{x:0,y:1,z:0}}},
 {tool:'set_transform',arguments:{node_id:'missing',position:{x:0,y:0,z:0}}}
]},baseline,host,null),/does not exist/)
assert.equal(JSON.stringify(baseline),snapshot)
const camera=baseline.document.content.nodes.find(n=>n.type==='camera')
if(camera){
 const moved=await executeSceneTool('set_camera',{node_id:camera.id,position:{x:2,y:2,z:4},look_at:{x:0,y:1,z:0},fov:45},baseline,host,null)
 const updated=moved.state.document.content.nodes.find(n=>n.id===camera.id)
 assert.deepEqual(updated.transform.position,{x:2,y:2,z:4})
 assert.deepEqual(updated.camera.lookAt,{x:0,y:1,z:0})
}
console.log('Reference adaptation passed: atomic batches, support measurements and explicit camera placement.')
