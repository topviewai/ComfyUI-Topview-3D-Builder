import { useEffect } from 'react'
import { exportSettings, type ExportSettings } from '../web/export-settings.js'
import { localUrl, send, type SceneState } from './host'
import type { DirectorApi } from '@topview/3d-builder'

let current: ExportSettings | null = null
let publish: ((settings: ExportSettings) => void) | null = null
export function initializeExport(state: SceneState, raw: Partial<ExportSettings> | undefined, onChange: (s: ExportSettings) => void) {
  current = exportSettings(state, raw || state.exportSettings)
  publish = onChange
}

// Called inside the upstream export hook, so both forms share the actual values.
export const getHostExportSettings = () => current
export function useHostExportSettings(s: any) {
  useEffect(() => {
    current = { output:s.output, fps:s.fps, timeUnit:s.timeUnit, cameraId:s.cameraId, currentFrame:s.currentFrame, start:s.start, end:s.end, aspectRatio:s.aspectRatio, exportHeight:s.exportHeight, viewportAspect:s.numericAspect }
    publish?.(current)
  }, [s.output,s.fps,s.timeUnit,s.cameraId,s.currentFrame,s.start,s.end,s.aspectRatio,s.exportHeight,s.numericAspect])
}

export async function renderWorkflow(api: DirectorApi, state: SceneState, job: {id:string; settings:ExportSettings; preview?:boolean}) {
  const s = exportSettings(state, job.settings)
  const aspect = s.aspectRatio === 'auto' ? s.viewportAspect : s.aspectRatio.split(':').map(Number).reduce((a,b)=>a/b)
  const onExport = async (blob: Blob) => {
    if(job.preview) { send('preview-media',{blob,kind:s.output}); return }
    const form = new FormData(); form.append('media',blob,s.output==='image'?'frame.png':'video.mp4')
    const response = await fetch(localUrl(`export-jobs/${job.id}`),{method:'POST',body:form})
    if(!response.ok) throw new Error((await response.json()).error || 'Export upload failed')
  }
  const common = {cameraId:s.cameraId==='__editor__' && state.editorView ? '__topview_export_view__' : s.cameraId,label:'ComfyUI',width:Math.round(s.exportHeight*aspect),height:s.exportHeight,userKeys:api.session.userKeys,userKeysEnabled:state.userKeysEnabled,chainCameraMotion:state.chainCameraMotion,onExport}
  api.stage.pause()
  if(s.output==='image') await api.stage.captureFrame({...common,frame:s.currentFrame})
  else await api.stage.recordRange({...common,frameStart:s.start,frameEnd:s.end,fps:s.fps,onProgress:p=>send('render-progress',p)})
  send('render-complete')
}
