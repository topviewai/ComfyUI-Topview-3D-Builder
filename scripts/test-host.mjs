import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const upstream = path.resolve(process.argv[2] || 'D:/topview-3d-builder')
const requireUpstream = createRequire(path.join(upstream, 'package.json'))
const { build } = createRequire(requireUpstream.resolve('tsup'))('esbuild')
const { outputFiles } = await build({ entryPoints: [path.join(root, 'editor-src/host.ts')], bundle: true, platform: 'node', format: 'esm', write: false })
globalThis.location = { href: 'http://localhost:8188/api/topview3d/editor/index.html', origin: 'http://localhost:8188' }
const messages = []
globalThis.parent = { postMessage: (message, origin) => { assert.equal(origin, location.origin); messages.push(message) } }
const { createHost } = await import(`data:text/javascript;base64,${Buffer.from(outputFiles[0].contents).toString('base64')}`)
const host = createHost(async () => {})
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'assets/manifest.json'), 'utf8'))
host.assets = manifest.assets
for (const item of manifest.assets) {
  for (const file of [item.file, item.cover].filter(Boolean)) assert.ok(fs.existsSync(path.join(root, 'assets', file)), `Missing bundled asset: ${file}`)
}
const characters = await host.adapter.searchAssets({ kind: 'character', pageNo: 1, pageSize: 100 })
assert.equal(characters.total, 4)
const poses = await host.adapter.searchAssets({ kind: 'pose', pageNo: 1, pageSize: 10 })
assert.equal(poses.items.length, 10)
assert.ok(poses.total >= 121)
assert.equal(host.adapter.resolveAssetUrl(characters.items[0].file), characters.items[0].modelUrl)
assert.throws(() => host.adapter.resolveAssetUrl('https://example.com/model.glb'))
assert.throws(() => host.adapter.resolveAssetUrl('../backend.py'))
const workflow = JSON.parse(fs.readFileSync(path.join(root, 'examples/topview-3d-preview.json'), 'utf8'))
const node = workflow.nodes.find((node) => node.type === 'Topview3DScene')
const raw = node.properties?.topview_scene_state || node.widgets_values.find((value) => typeof value === 'string' && value.startsWith('{'))
host.state = JSON.parse(raw)
const oldDocument = await host.adapter.loadDocument('test')
assert.deepEqual(oldDocument, host.state.document)
oldDocument.extra = { test: true }
assert.notDeepEqual(oldDocument, host.state.document)
const document = structuredClone(host.state.document)
document.content.selectionGroups = [{ id: 'group-test', name: 'Test group', nodeIds: document.content.nodes.map((node) => node.id) }]
document.content.editorial = { version: 1, activeSequenceId: 'sequence-test', sequences: [{ id: 'sequence-test', clips: [] }] }
document.content.environment.lighting = { intensity: 1.4, direction: 45 }
const fcurves = { version: 1, test: { keys: [{ frame: 12, value: 2 }] } }
host.state.render_id = 'old-preview'
await host.adapter.saveDocumentState('test', document, fcurves)
const saved = JSON.parse(messages.at(-1).state)
assert.deepEqual(saved.document, document)
assert.deepEqual(saved.fcurves, fcurves)
assert.equal(saved.render_id, '')
host.state.render_id = 'current-preview'
await host.adapter.saveDocumentState('test', document, fcurves)
assert.equal(host.state.render_id, 'current-preview')
console.log('Host checks passed: bundled assets, pagination, local resolution, legacy scene, cloning, atomic state save and preview invalidation.')
