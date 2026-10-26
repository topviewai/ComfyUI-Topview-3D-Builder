import { localUrl } from './host'

export interface Profile { id: string; name: string; provider: string; base_url: string; model: string; has_key: boolean }
export interface Preset { id: string; label: string; base_url: string }
export interface AgentConfig { profiles: Profile[]; active_id: string; presets: Preset[] }
export async function agentRequest<T>(action: string, body?: unknown, signal?: AbortSignal): Promise<T> {
  let token = localStorage.getItem('topview-agent-session')
  if (!token) {
    token = Array.from(crypto.getRandomValues(new Uint8Array(32)), (n) => n.toString(16).padStart(2, '0')).join('')
    localStorage.setItem('topview-agent-session', token)
  }
  const response = await fetch(localUrl(`agent/${action}`), {
    method: body === undefined ? 'GET' : 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Topview-Agent-Session': token },
    body: body === undefined ? undefined : JSON.stringify(body), signal,
  })
  if (response.status === 404) throw new Error('Agent API unavailable. Restart ComfyUI after updating this plugin. / 请重启 ComfyUI 后重试。')
  const result = await response.json()
  if (!response.ok) throw new Error(result.error || `HTTP ${response.status}`)
  return result
}
