import { agentSystemPrompt } from './agent-prompt'
import type { DirectorAgentAdapter, AgentMessage, DirectorApi } from '@topview/3d-builder'
import { agentRequest, type AgentConfig } from './agent-client'
import { agentTools, executeSceneTool } from './agent-tools'
import type { createHost, SceneState } from './host'

export function createAgent(host: ReturnType<typeof createHost>, getApi: () => DirectorApi | null, onConfigurationRequired: () => void = () => {}) {
  const history = (): AgentMessage[] => Array.isArray(host.state.agentHistory)
    ? host.state.agentHistory.filter(m => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string' && typeof m.messageId === 'string' && typeof m.turnId === 'string') : []
  function saveTurn(turnId: string, text: string, answer: string) {
    host.state.agentHistory = [...history(),
      { messageId: crypto.randomUUID(), turnId, role: 'user', content: text },
      { messageId: crypto.randomUUID(), turnId, role: 'assistant', content: answer }]
    host.publish()
  }
  let controller: AbortController | null = null
  let previous: SceneState | null = null
  let committed = ''
  const fingerprint = () => JSON.stringify([host.state.document, host.state.fcurves])
  const adapter: DirectorAgentAdapter = {
    async loadHistory() { return structuredClone(history()) },
    async listModels() {
      const config = await agentRequest<AgentConfig>('config')
      return config.profiles.filter(p => p.id === config.active_id).map(p => ({ id: p.model, label: `${p.name} · ${p.model}`, available: true }))
    },
    async stop() { controller?.abort() },
    async send(_id, input, emit, signal) {
      const turnId = crypto.randomUUID()
      controller = new AbortController()
      const abort = () => controller?.abort()
      signal?.addEventListener('abort', abort, { once: true })
      if (signal?.aborted) controller.abort()
      const currentSignal = controller.signal
      emit({ type: 'turn.status', turnId, status: 'running' })
      let answer = ''
      try {
        const config = await agentRequest<AgentConfig>('config', undefined, currentSignal)
        currentSignal.throwIfAborted()
        const profile = config.profiles.find(p => p.id === config.active_id)
        if (!profile?.has_key || !profile.model?.trim()) {
          onConfigurationRequired()
          throw new Error('请先在 Agent API 设置中保存 Key 和模型，再重新发送。 / Save your API key and model in Agent API settings, then send again.')
        }
        let staged = structuredClone(host.state)
        let changed = false
        const messages: any[] = [{ role: 'system', content: agentSystemPrompt + '\nCurrent editor context: ' + JSON.stringify(input.context) }, ...history().slice(-12).map(m => ({ role: m.role, content: m.content })), { role: 'user', content: input.text }]
        while (true) {
          currentSignal.throwIfAborted()
          const response = await agentRequest<{ message: any; finish_reason: string }>('complete', { profile_id: profile.id, messages, tools: agentTools }, currentSignal)
          currentSignal.throwIfAborted()
          if (response.finish_reason === 'length' || response.finish_reason === 'content_filter') throw new Error('Model response incomplete; scene changes discarded.')
          const message = response.message
          messages.push({ ...message, role: 'assistant' })
          if (typeof message.content === 'string' && message.content) { answer += message.content; emit({ type: 'text.delta', turnId, content: message.content }) }
          const calls = message.tool_calls || []
          if (!Array.isArray(calls)) throw new Error('Invalid tool calls')
          if (!calls.length) {
            if (!answer) throw new Error('Model returned an empty answer')
            if (changed) {
              previous = structuredClone(host.state)
              host.state = staged
              committed = fingerprint()
              host.publish()
              const session = getApi()?.session
              if (staged.userKeysEnabled && session && !session.userKeysEnabled) session.toggleUserKeys()
              emit({ type: 'document.changed', turnId })
            }
            saveTurn(turnId, input.text, answer)
            emit({ type: 'turn.status', turnId, status: 'succeeded' })
            return { turnId }
          }
          for (const call of calls) {
            currentSignal.throwIfAborted()
            const name = call.function?.name
            emit({ type: 'tool.start', turnId, callId: call.id, name })
            let result: unknown
            try {
              const done = await executeSceneTool(name, JSON.parse(call.function.arguments || '{}'), staged, host, getApi())
              currentSignal.throwIfAborted()
              staged = done.state; changed ||= done.changed; result = done.result
              emit({ type: 'tool.done', turnId, callId: call.id, ok: true, result })
            } catch (error) {
              currentSignal.throwIfAborted()
              result = { error: String(error) }
              emit({ type: 'tool.done', turnId, callId: call.id, ok: false, summary: String(error) })
            }
            messages.push({ role: 'tool', tool_call_id: call.id, content: JSON.stringify(result) })
          }
        }
      } catch (error) {
        saveTurn(turnId, input.text, [answer, currentSignal.aborted ? '已取消，场景修改未应用。 / Cancelled; scene changes were not applied.' : `请求失败，场景修改未应用。 / Request failed; scene changes were not applied. ${String(error)}`].filter(Boolean).join('\n\n'))
        emit({ type: 'turn.status', turnId, status: currentSignal.aborted ? 'cancelled' : 'failed', error: currentSignal.aborted ? undefined : String(error) })
        return { turnId }
      } finally { signal?.removeEventListener('abort', abort); controller = null }
    },
  }
  return { adapter, async undo() {
    const api = getApi()
    if (!previous || !api || api.agent?.locked || fingerprint() !== committed) return
    await api.session.flushPendingUserWrites()
    const error = await api.session.save({ captureCover: false })
    if (error) throw new Error(error)
    if (fingerprint() !== committed) return
    const agentHistory = host.state.agentHistory
    host.state = { ...previous, agentHistory }; previous = null; host.publish()
    await api.session.reloadFromHost()
    if (api.session.userKeysEnabled !== host.state.userKeysEnabled) api.session.toggleUserKeys()
  }, get canUndo() { return !!previous && fingerprint() === committed } }
}
