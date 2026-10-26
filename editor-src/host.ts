import { normalizeLocale, translate } from '../web/i18n.js'
import type { DirectorDocument, HostAdapter } from '@topview/3d-builder'

export const base = new URL('../', location.href)
export const localUrl = (path: string) => new URL(path, base).href
let locale = 'en'
export const setLocale = (value: string) => { locale = normalizeLocale(value); return locale }
export const hostText = (key: string, values = {}) => translate(locale, key, values)
export const send = (type: string, data = {}) => parent.postMessage({ source: 'topview3d-editor', type, ...data }, location.origin)

export interface SceneState {
  agentGuideExpanded?: boolean
  agentHistory?: import('@topview/3d-builder').AgentMessage[]
  exportSettings?: import('../web/export-settings.js').ExportSettings
  viewportAspect?: number
  editorView?: {position:{x:number;y:number;z:number};rotation:{x:number;y:number;z:number};lookAt:{x:number;y:number;z:number};fov:number}
  version: 1
  document: DirectorDocument
  fcurves: unknown
  width: number
  height: number
  frame: number
  cameraId: string
  userKeysEnabled: boolean
  chainCameraMotion: boolean
  render_id: string
}
export interface Asset {
  id: string
  kind: string
  name: string
  key?: string
  file?: string
  category?: string
  tags?: string[]
  cover?: string
  rig?: string
}
export async function readJson(url: string) {
  const response = await fetch(url)
  if (!response.ok) throw new Error(hostText('loadFailed', { detail: `${response.status}: ${url}` }))
  return response.json()
}

export function createHost(onExported: () => Promise<void>) {
  let state: SceneState
  let assets: Asset[] = []
  const assetUrl = (path: string) => localUrl(`assets/${path.split('/').map(encodeURIComponent).join('/')}`)
  const resolveAsset = (key: string): string => {
    const asset = assets.find((item) => item.key === key || item.file === key)
    if (asset?.file) return assetUrl(asset.file)
    const url = new URL(key, location.origin)
    if (url.origin === location.origin && url.pathname.startsWith(new URL(localUrl('assets/')).pathname)) return url.href
    throw new Error(hostText('missingAsset', { detail: key }))
  }
  const publish = () => {
    const raw = JSON.stringify(state)
    if (new TextEncoder().encode(raw).length > 8 * 1024 * 1024) throw new Error(hostText('tooLarge'))
    send('state', { state: raw })
  }
  const update = (document: DirectorDocument, fcurves: unknown) => {
    const changed = JSON.stringify(state.document) !== JSON.stringify(document) || JSON.stringify(state.fcurves) !== JSON.stringify(fcurves)
    state.document = structuredClone(document)
    state.fcurves = structuredClone(fcurves ?? null)
    if (changed) state.render_id = ''
    publish()
  }
  const adapter: HostAdapter<DirectorDocument> = {
    loadDocument: async () => structuredClone(state.document),
    loadFCurves: async () => structuredClone(state.fcurves),
    saveDocument: async (_, document) => update(document, state.fcurves),
    saveDocumentState: async (_, document, fcurves) => update(document, fcurves),
    onDocumentChange: (_, document, fcurves) => update(document, fcurves),
    resolveAssetUrl: resolveAsset,
    resolveMediaUrl: (ref) => resolveAsset(ref.sourceUrl || (ref.kind === 'character' ? '' : ref.sourcePath) || ''),
    async searchAssets(query) {
      const words = (query.keyword || '').toLowerCase().split(/\s+/).filter(Boolean)
      const matches = assets.filter((item) => item.kind === query.kind && item.file
        && (!query.category || item.category === query.category)
        && (query.tags || []).every((tag) => item.tags?.includes(tag))
        && words.every((word) => `${item.name} ${item.id} ${item.category || ''} ${(item.tags || []).join(' ')}`.toLowerCase().includes(word)))
      const start = (query.pageNo - 1) * query.pageSize
      return {
        total: matches.length, pageNo: query.pageNo, pageSize: query.pageSize,
        items: matches.slice(start, start + query.pageSize).map((item) => ({
          id: item.kind === 'pose' ? item.id.replace(/^a3d_pose_/, '') : item.id,
          name: item.name, file: item.key || item.file!, category: item.category, tag: item.category, tags: item.tags,
          cover: item.cover ? assetUrl(item.cover) : '', coverUrl: item.cover ? assetUrl(item.cover) : undefined,
          modelUrl: assetUrl(item.file!), rig: item.rig?.toLowerCase() === 'ual1' ? 'ual1' as const : 'mixamorig' as const,
        })),
      }
    },
    async listAssetFacets(kind) {
      const items = assets.filter((item) => item.kind === kind)
      const counts = (values: string[]) => [...new Set(values)].map((value) => ({ value, count: values.filter((v) => v === value).length }))
      return { categories: counts(items.flatMap((item) => item.category ? [item.category] : [])), tags: counts(items.flatMap((item) => item.tags || [])) }
    },
    async loadPoseAsset(url) {
      const pose = await readJson(resolveAsset(url))
      return { hips: pose.hips, bones: pose.bones, poseId: pose.pose_id }
    },
    async loadPoseById(id) {
      const asset = assets.find((item) => item.id === id || item.id === `a3d_pose_${id}`)
      return asset?.file ? adapter.loadPoseAsset!(assetUrl(asset.file)) : null
    },
    async onExport(blob, meta) {
      if (!meta.mimeType.startsWith('image/') && !meta.mimeType.startsWith('video/')) throw new Error('Unsupported export type')
      const form = new FormData()
      form.append('image', blob, `topview-${crypto.randomUUID()}-${meta.filename}`)
      form.append('type', 'input')
      form.append('subfolder', 'topview3d/exports')
      const response = await fetch(new URL('../upload/image', base), { method: 'POST', body: form })
      if (!response.ok) throw new Error(hostText('uploadFailed', { detail: `HTTP ${response.status}` }))
      const file = await response.json()
      const requestId = crypto.randomUUID()
      await new Promise<void>((resolve, reject) => {
        const timer = window.setTimeout(() => { window.removeEventListener('message', receive); reject(new Error(hostText('timeout'))) }, 15000)
        const receive = (event: MessageEvent) => {
          if (event.origin !== location.origin || event.source !== parent || event.data?.source !== 'topview3d-host' || event.data.requestId !== requestId) return
          clearTimeout(timer)
          window.removeEventListener('message', receive)
          if (event.data.error) reject(new Error(event.data.error))
          else resolve()
        }
        window.addEventListener('message', receive)
        send('media', { requestId, file, kind: meta.mimeType.startsWith('video/') ? 'video' : 'image' })
      })
      await onExported()
    },
  }
  return { adapter, publish, get state() { return state }, set state(value: SceneState) { state = value }, set assets(value: Asset[]) { assets = value } }
}
