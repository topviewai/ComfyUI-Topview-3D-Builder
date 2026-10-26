import { useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { createPortal } from 'react-dom'
import { DirectorStudio, createInitialDraft, CAMERA_PRESETS, type DirectorApi } from '@topview/3d-builder'
import { createHost, hostText, localUrl, readJson, send, setLocale, type SceneState } from './host'
import './styles.css'
import { AgentGuide } from './AgentGuide'
import { initializeExport, renderWorkflow } from './export-bridge'

let api: DirectorApi | null = null
let busy = false
let renderJob: any = null
let finishExport: (() => Promise<void>) | null = null
const host = createHost(async () => {
  if (!finishExport) throw new Error(hostText('notReady'))
  await finishExport()
})
async function initialize(raw: string) {
  host.assets = (await readJson(localUrl('assets/manifest.json'))).assets
  let state: SceneState
  if (raw) {
    state = JSON.parse(raw)
    if (state.version !== 1 || state.document?.type !== 'biz/scene3d-director-document' || !Array.isArray(state.document?.content?.nodes)) throw new Error(hostText('invalidScene'))
  } else {
    const document = await createInitialDraft(host.adapter, { name: 'ComfyUI Scene', fps: 24, totalFrames: 120, camera: CAMERA_PRESETS[0] })
    state = { version: 1, document, fcurves: null, width: 1280, height: 720, frame: 0, cameraId: document.content.activeShotCameraNodeId || '', userKeysEnabled: true, chainCameraMotion: false, render_id: '' }
  }
  if (!Number.isInteger(state.width) || !Number.isInteger(state.height) || state.width < 64 || state.height < 64 || state.width > 4096 || state.height > 4096 || !Number.isFinite(state.frame)) throw new Error(hostText('invalidSize'))
  host.state = state
  host.publish()
}

async function savePreview() {
  if (!api?.session.ready) throw new Error(hostText('notReady'))
  const { session, stage } = api
  if (session.playing) session.togglePlay()
  stage.pause()
  await session.flushPendingUserWrites()
  const error = await session.save({ captureCover: false })
  if (error) throw new Error(error)
  const state = host.state
  state.editorView = stage.captureEditorView() || undefined
  state.viewportAspect = stage.viewportAspect()
  state.frame = Math.round(session.frame)
  state.cameraId = session.activeCameraId || state.document.content.activeShotCameraNodeId || '__editor__'
  state.userKeysEnabled = session.userKeysEnabled
  state.chainCameraMotion = session.chainCameraMotion
  state.render_id = ''
  host.publish()
  const image = await stage.previewFrame({ cameraId: state.cameraId, label: 'ComfyUI', width: state.width, height: state.height, frame: state.frame, userKeys: session.userKeys, userKeysEnabled: state.userKeysEnabled, chainCameraMotion: state.chainCameraMotion })
  const form = new FormData()
  form.append('state', JSON.stringify(state))
  form.append('image', image, 'frame.png')
  const response = await fetch(localUrl('render'), { method: 'POST', body: form })
  const result = await response.json()
  if (!response.ok) throw new Error(result.error || `HTTP ${response.status}`)
  state.render_id = result.render_id
  host.publish()
}

function App() {
  const [loaded, setLoaded] = useState(false)
  const [ready, setReady] = useState(false)
  const [locale, updateLocale] = useState('en')
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const [showAgentGuide, setShowAgentGuide] = useState(true)
  const [guideAnchor, setGuideAnchor] = useState<Element | null>(null)
  const [toolbar, setToolbar] = useState<Element | null>(null)
  useEffect(() => {
    let initialized = false
    const receive = async (event: MessageEvent) => {
      if (event.origin !== location.origin || event.source !== parent || event.data?.source !== 'topview3d-host') return
      if (event.data.type === 'init' || event.data.type === 'locale') {
        const next = setLocale(event.data.locale)
        updateLocale(next)
        document.documentElement.lang = next
      }
      if (event.data.type !== 'init' || initialized) return
      initialized = true
      try {
        renderJob = event.data.renderJob || null
        await initialize(event.data.state)
        initializeExport(host.state, event.data.exportSettings, value => { host.state.exportSettings = value; host.publish(); send('export-settings',{settings:value}) })
        if(renderJob && host.state.editorView) {
          const view = host.state.editorView
          host.state.document.content.nodes.push({id:'__topview_export_view__',name:'Export view',type:'camera',visible:true,locked:false,transform:{position:view.position,rotation:view.rotation,scale:{x:1,y:1,z:1}},camera:{projection:"perspective",fovAxis:"vertical",near:0.1,far:1000,isPrimary:false,fov:view.fov,lookAt:view.lookAt}})
        }
        setShowAgentGuide(host.state.agentGuideExpanded !== false)
        setLoaded(true)
      } catch (e) { setError(String(e)); if(renderJob) send('render-error',{error:String(e)}) }
    }
    window.addEventListener('message', receive)
    send('ready')
    return () => window.removeEventListener('message', receive)
  }, [])
  useEffect(() => {
    if (!loaded) return
    const timer = window.setInterval(() => {
      if (!api?.session.ready) return
      const session = api.session
      const state = host.state
      if (state.document.content.nodes.some((node) => node.id === state.cameraId && node.type === 'camera')) session.setActiveCamera(state.cameraId)
      if (session.userKeysEnabled !== state.userKeysEnabled) session.toggleUserKeys()
      if (session.chainCameraMotion !== state.chainCameraMotion) session.toggleChainCameraMotion()
      session.setFrame(state.frame)
      setReady(true)
      window.clearInterval(timer)
      if(renderJob) void renderWorkflow(api!,host.state,renderJob).catch(e=>send('render-error',{error:String(e)}))
    }, 100)
    const refreshAnchors = () => {
      setToolbar(document.querySelector('.t3d-topbar-right'))
      setGuideAnchor(document.querySelector('.t3d-viewport-fs-wrap'))
    }
    const observer = new MutationObserver(refreshAnchors)
    observer.observe(document.getElementById('root')!, { childList: true, subtree: true })
    refreshAnchors()
    return () => { clearInterval(timer); observer.disconnect() }
  }, [loaded])
  function toggleAgentGuide() {
    const expanded = !showAgentGuide
    setShowAgentGuide(expanded)
    host.state.agentGuideExpanded = expanded
    host.publish()
  }
  async function saveAndClose() {
    if (busy) throw new Error(hostText('busy'))
    busy = true
    setSaving(true)
    setError('')
    try { await savePreview(); send('close') }
    catch (e) { setError(String(e)); throw e }
    finally { busy = false; setSaving(false) }
  }
  useEffect(() => { finishExport = saveAndClose; return () => { finishExport = null } }, [])
  return <div className="host">
    {error && <div className="host-status" role="alert">{hostText('error', { detail: error })} <button onClick={() => location.reload()}>{hostText('retry')}</button> <button onClick={() => send('discard')}>{hostText('discard')}</button></div>}
    <main>{loaded && <DirectorStudio documentId="comfyui" adapter={host.adapter} locale={locale} onReady={(value) => { api = value }} autoSaveIntervalMs={renderJob ? 0 : 3000} />}</main>
    {toolbar && !renderJob && createPortal(<><button className="host-save-exit" onClick={toggleAgentGuide}>{locale.startsWith('zh') ? '使用 AI Agent' : 'Use AI Agent'}</button><button className="host-save-exit" disabled={!ready || saving} onClick={() => { void saveAndClose().catch(() => {}) }}>{hostText('close')}</button></>, toolbar)}
    {loaded && !renderJob && guideAnchor && createPortal(<AgentGuide locale={locale} expanded={showAgentGuide} onToggle={toggleAgentGuide} />, guideAnchor)}
    {saving && <div className="host-busy" role="alert">{hostText('busy')}</div>}
  </div>
}
createRoot(document.getElementById('root')!).render(<App />)
