export interface ExportSettings { output:'image'|'video'; cameraId:string; timeUnit:'frames'|'seconds'; fps:number; currentFrame:number; start:number; end:number; exportHeight:720|1080|1440; aspectRatio:string; viewportAspect:number }
export function exportSettings(state: unknown, raw?: Partial<ExportSettings>): ExportSettings
export const resolutions: number[]
export const aspects: string[]
