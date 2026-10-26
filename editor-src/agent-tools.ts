import { z } from 'zod'
import { zodToJsonSchema } from 'zod-to-json-schema'
import { applyStudioIntentInPlace, parseDirectorDocument, FCurveSet, listStudioCameraPresets } from '@topview/3d-builder/evaluate'
import type { DirectorApi } from '@topview/3d-builder'
import type { SceneState, createHost } from './host'

const vec = z.object({ x: z.number().finite().min(-10000).max(10000), y: z.number().finite().min(-10000).max(10000), z: z.number().finite().min(-10000).max(10000) }).strict()
const id = z.string().min(1).max(150)
const schemas = {
  read_scene: z.object({}).strict(),
  inspect_scene: z.object({}).strict(),
  batch_edit: z.object({operations:z.array(z.object({tool:z.string(),arguments:z.record(z.unknown())}).strict()).min(1)}).strict(),
  list_assets: z.object({ kind: z.enum(['character', 'pose', 'camera']), keyword: z.string().max(120).optional(), page: z.number().int().min(1).max(100).optional() }).strict(),
  add_primitive: z.object({ name: z.string().min(1).max(100), shape: z.enum(['box', 'sphere', 'cylinder', 'cone', 'plane']), position: vec, scale: vec.optional(), color: z.string().regex(/^#[a-fA-F0-9]{6}$/).optional() }).strict(),
  add_character: z.object({ asset_id: id, position: vec }).strict(),
  add_camera: z.object({ preset_id: id, subject_node_id: id.optional() }).strict(),
  set_transform: z.object({ node_id: id, position: vec.optional(), rotation: vec.optional(), scale: vec.optional() }).strict(),
  set_camera: z.object({ node_id: id, position: vec.optional(), fov: z.number().min(5).max(120).optional(), look_at: vec.optional() }).strict(),
  apply_pose: z.object({ node_id: id, pose_id: id }).strict(),
  set_lighting: z.object({ intensity: z.number().min(0).max(3), direction: z.number().min(0).max(360) }).strict(),
  set_keyframe: z.object({ node_id: id, property: z.enum(['position', 'rotation', 'scale', 'lookAt', 'fov']), frame: z.number().int().min(0).max(100000), value: z.array(z.number().finite().min(-10000).max(10000)).min(1).max(3), interpolation: z.enum(['linear', 'ease-in-out', 'ease-in', 'ease-out']) }).strict(),
}
const descriptions: Record<keyof typeof schemas, string> = {
  batch_edit: 'Apply multiple independent editing operations atomically. Each item has tool and arguments matching an editing tool. No nested batches or read tools. All changes roll back if any operation fails. Use returned node IDs in subsequent calls.',
  inspect_scene: 'Inspect static primitive dimensions, axis-aligned world bounds for unrotated primitives, support heights and floor penetration. Character meshes and camera framing are not verified.',
  read_scene: 'Read current scene objects, cameras, lighting, timeline, and user keyframes. Coordinates in meters, right-handed Y-up; rotations in degrees. Read before editing.',
  list_assets: 'List installed characters, static poses, or camera presets. Use returned IDs; never invent asset URLs. Motions library is unavailable.',
  add_primitive: 'Add a basic shape. Unit dimensions; set scale for size. A plane is placed horizontally.',
  add_character: 'Add an installed character using the asset ID from list_assets.',
  add_camera: 'Add a camera from list_assets camera preset. Optionally frame a character.',
  set_transform: 'Set static object transform (rotation in degrees). Animated properties must be edited using set_keyframe instead.',
  set_camera: 'Set camera position, FOV and/or a free look-at point. Setting look_at clears subject following.',
  apply_pose: 'Apply an installed static pose to a character. Use list_assets pose first.',
  set_lighting: 'Set global light intensity (0-3, default 1) and direction (degrees).',
  set_keyframe: 'Insert/replace one keyframe within the existing timeline range. Use 3 values for xyz, 1 for camera fov. Create start and end keys to animate. Existing keys on other frames remain intact.',
}
export const agentTools = Object.entries(schemas).map(([name, schema]) => {
  const { $schema, ...parameters } = zodToJsonSchema(schema)
  return { type: 'function', function: { name, description: descriptions[name as keyof typeof schemas], parameters } }
})

export function sceneSummary(state: SceneState) {
  const content = state.document.content
  return { nodes: content.nodes.map(({ id, name, type, transform, camera, locked, primitive, character }) => ({ id, name, type, transform, camera, locked, primitive, character })),
    lighting: content.environment.lighting, fps: content.timeline.fps, frameStart: content.timeline.frameStart, frameEnd: content.timeline.frameEnd,
    userKeys: FCurveSet.parseUserKeys(state.fcurves), cameraMotionClips: content.timeline.animation.cameraMotionClips.map((clip) => ({ id: clip.id, target: clip.target, frameStart: clip.frameStart, frameEnd: clip.frameEnd })) }
}

export async function executeSceneTool(name: string, input: unknown, state: SceneState, host: ReturnType<typeof createHost>, api: DirectorApi | null): Promise<{state:SceneState;result:unknown;changed:boolean}> {
  if (!Object.hasOwn(schemas, name)) throw new Error(`Unknown tool: ${name}`)
  if (name === 'batch_edit') {
    const {operations} = schemas.batch_edit.parse(input)
    let staged = state
    const results: unknown[] = []
    for (const operation of operations) {
      if (['batch_edit','read_scene','list_assets','inspect_scene'].includes(operation.tool)) throw new Error('Batch accepts editing tools only')
      const applied = await executeSceneTool(operation.tool, operation.arguments, staged, host, api)
      staged = applied.state; results.push(applied.result)
    }
    return {state:staged,result:{results},changed:true}
  }
  // Each tool edits a clone; schema or runtime failures never partially change the scene.
  const next = structuredClone(state)
  const doc = next.document
  const node = (nodeId: string) => {
    const found = doc.content.nodes.find((item) => item.id === nodeId)
    if (!found || found.locked) throw new Error('Node does not exist or is locked')
    return found
  }
  const changed = !['read_scene', 'list_assets', 'inspect_scene'].includes(name)
  let result: unknown = { ok: true }
  switch (name) {
    case 'inspect_scene': schemas.inspect_scene.parse(input); result = inspectScene(state); break
    case 'read_scene': schemas.read_scene.parse(input); result = sceneSummary(state); break
    case 'list_assets': {
      const args = schemas.list_assets.parse(input)
      result = args.kind === 'camera' ? listStudioCameraPresets() : await host.adapter.searchAssets({ kind: args.kind, keyword: args.keyword, pageNo: args.page || 1, pageSize: args.kind === 'pose' ? 1000 : 30 })
      break
    }
    case 'add_primitive': {
      const args = schemas.add_primitive.parse(input)
      if (args.scale && Object.values(args.scale).some((n) => n <= 0)) throw new Error('Scale must be positive')
      const shapes = { box: ['BoxGeometry', { width: 1, height: 1, depth: 1 }], sphere: ['SphereGeometry', { radius: 0.5 }], cylinder: ['CylinderGeometry', { radiusTop: 0.5, radiusBottom: 0.5, height: 1 }], cone: ['ConeGeometry', { radius: 0.5, height: 1 }], plane: ['PlaneGeometry', { width: 1, height: 1 }] } as const
      const [kind, parameters] = shapes[args.shape]
      const nodeId = `agent_${crypto.randomUUID()}`
      doc.content.nodes.push({ id: nodeId, name: args.name, type: 'primitive', visible: true, locked: false, transform: { position: args.position, rotation: { x: args.shape === 'plane' ? -90 : 0, y: 0, z: 0 }, scale: args.scale || { x: 1, y: 1, z: 1 } }, primitive: { kind, parameters, appearance: { color: args.color || '#cccccc' } } })
      result = { node_id: nodeId }; break
    }
    case 'add_character': {
      const args = schemas.add_character.parse(input)
      const assets = await host.adapter.searchAssets({ kind: 'character', pageNo: 1, pageSize: 100 })
      const asset = assets.items.find((item) => 'id' in item && item.id === args.asset_id)
      if (!asset || !('file' in asset) || !asset.file) throw new Error('Character must be from the installed library')
      const applied = applyStudioIntentInPlace(doc, { type: 'add-character', libraryId: args.asset_id, name: asset.name, modelUrl: asset.file }, api?.stage.poseBank)
      node(applied.nodeId!).transform.position = args.position
      result = applied; break
    }
    case 'add_camera': {
      const args = schemas.add_camera.parse(input)
      if (args.subject_node_id) node(args.subject_node_id)
      result = applyStudioIntentInPlace(doc, { type: 'add-camera', presetId: args.preset_id, subjectNodeId: args.subject_node_id }); break
    }
    case 'set_transform': {
      const args = schemas.set_transform.parse(input)
      node(args.node_id)
      if (args.scale && Object.values(args.scale).some((n) => n <= 0)) throw new Error('Scale must be positive')
      const keys = FCurveSet.parseUserKeys(next.fcurves)[args.node_id]
      if (keys && ['position', 'rotation', 'scale'].some((p) => keys[p as 'position']?.length)) throw new Error('Object has animation keys. Use set_keyframe to edit its animation.')
      result = applyStudioIntentInPlace(doc, { type: 'patch-transform', nodeId: args.node_id, position: args.position, rotation: args.rotation, scale: args.scale }); break
    }
    case 'set_camera': {
      const args = schemas.set_camera.parse(input)
      const target = node(args.node_id)
      const camera = target.camera
      if (!camera) throw new Error('Not a camera')
      if (args.position) target.transform.position = args.position
      if (args.fov !== undefined) camera.fov = args.fov
      if (args.look_at) { camera.lookAt = args.look_at; delete camera.subject; delete camera.lookAtTarget }
      break
    }
    case 'apply_pose': {
      const args = schemas.apply_pose.parse(input)
      node(args.node_id)
      if (!api) throw new Error('Editor not ready')
      const pose = await host.adapter.loadPoseById!(args.pose_id)
      if (!pose) throw new Error('Unknown installed pose')
      api.stage.poseBank.applyBones(args.pose_id, pose.hips, pose.bones)
      applyStudioIntentInPlace(doc, { type: 'apply-pose', nodeId: args.node_id, presetId: args.pose_id }, api.stage.poseBank)
      break
    }
    case 'set_lighting': doc.content.environment.lighting = schemas.set_lighting.parse(input); break
    case 'set_keyframe': {
      const args = schemas.set_keyframe.parse(input)
      const target = node(args.node_id)
      if ((args.property === 'lookAt' || args.property === 'fov') && !target.camera) throw new Error('This property requires a camera')
      if (args.value.length !== (args.property === 'fov' ? 1 : 3)) throw new Error('Wrong keyframe value dimensions')
      if (args.property === 'scale' && args.value.some((n) => n <= 0)) throw new Error('Scale must be positive')
      if (args.property === 'fov' && (args.value[0] < 5 || args.value[0] > 120)) throw new Error('FOV must be 5–120')
      if (args.frame < doc.content.timeline.frameStart || args.frame > doc.content.timeline.frameEnd) throw new Error('Frame outside timeline range')
      const keys = FCurveSet.parseUserKeys(next.fcurves)
      const tracks = keys[args.node_id] ||= {}
      tracks[args.property] = [...(tracks[args.property] || []).filter((key) => key.frame !== args.frame), { id: crypto.randomUUID(), frame: args.frame, value: args.value, interpolation: args.interpolation }].sort((a, b) => a.frame - b.frame)
      next.fcurves = FCurveSet.persist(next.fcurves ? FCurveSet.parse(next.fcurves) : null, keys)
      next.userKeysEnabled = true
      break
    }
  }
  if (changed) {
    if (doc.content.nodes.length > 1000) throw new Error('Scene object limit reached')
    next.document = parseDirectorDocument(doc)
    next.render_id = ''
  }
  return { state: changed ? next : state, result, changed }
}

function inspectScene(state: SceneState) {
  const keys = FCurveSet.parseUserKeys(state.fcurves)
  const measurements = state.document.content.nodes.filter(n=>n.type!=='camera').map(n=>{
    const base = {node_id:n.id,name:n.name,origin:n.transform.position}
    const p = n.primitive
    if (!p || Object.values(n.transform.rotation).some(v=>v!==0) || keys[n.id]) return {...base,measurement:'unavailable',reason:'Posed meshes, rotated geometry and animated bounds require renderer measurement.'}
    const params = p.parameters as Record<string,number>
    let size: number[]
    if (p.kind==='BoxGeometry') size=[params.width ?? 1,params.height ?? 1,params.depth ?? 1]
    else if (p.kind==='SphereGeometry') size=Array(3).fill(2*(params.radius ?? .5))
    else if (p.kind==='CylinderGeometry' || p.kind==='ConeGeometry') {const d=2*Math.max(params.radius ?? 0,params.radiusTop ?? 0,params.radiusBottom ?? .5);size=[d,params.height ?? 1,d]}
    else return {...base,measurement:'unavailable',reason:'Unsupported primitive bounds.'}
    const axes=['x','y','z'] as const
    size=size.map((v,i)=>v*Math.abs(n.transform.scale[axes[i]]))
    const min=size.map((v,i)=>n.transform.position[axes[i]]-v/2)
    const max=size.map((v,i)=>n.transform.position[axes[i]]+v/2)
    return {...base,measurement:'static primitive bounding box',size,bounds:{min,max},topY:max[1],warnings:min[1]<-.02?['Below Y=0; compare against actual support surface.']:[]}
  })
  return {measurements,visualVerified:false,notes:'Bounds are not mesh contact or visibility evidence. Y=0 is a reference, not a measured ground surface.'}
}
