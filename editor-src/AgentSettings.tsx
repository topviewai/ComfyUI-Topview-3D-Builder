import { useEffect, useState } from 'react'
import { agentRequest, type AgentConfig, type Profile } from './agent-client'

export function AgentSettings({ locale, onClose, onSaved }: { locale: string; onClose: () => void; onSaved: () => void }) {
  const zh = locale.startsWith('zh')
  const t = (cn: string, en: string) => zh ? cn : en
  const [config, setConfig] = useState<AgentConfig | null>(null)
  const [draft, setDraft] = useState<Profile>({ id: crypto.randomUUID(), name: '', provider: 'qwen-cn', base_url: '', model: '', has_key: false })
  const [key, setKey] = useState('')
  const [models, setModels] = useState<string[]>([])
  const presetModels = draft.provider === 'qwen-cn' ? ['qwen3.7-plus', 'qwen3.8-flash', 'qwen3.8-max', 'qwen-plus', 'qwen-max'] : []
  const choices = [...new Set([...models, ...presetModels, ...(draft.model ? [draft.model] : [])])]
  const [modelStatus, setModelStatus] = useState('')
  const [loadingModels, setLoadingModels] = useState(false)
  const canUseSavedKey = Boolean(config?.profiles.some((p) => p.id === draft.id && p.has_key && p.base_url === draft.base_url && p.provider === draft.provider))
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState('')
  const [saved, setSaved] = useState(false)
  function select(profile: Profile) { setDraft(profile); setKey(''); setModels([]); setSaved(true); setStatus('') }
  useEffect(() => {
    void agentRequest<AgentConfig>('config').then((value) => {
      setConfig(value)
      const active = value.profiles.find((p) => p.id === value.active_id)
      if (active) select(active)
      else setDraft((old) => ({ ...old, model: 'qwen3.7-plus', base_url: value.presets.find((p) => p.id === 'qwen-cn')!.base_url }))
    }).catch((e) => setStatus(String(e)))
  }, [])
  useEffect(() => {
    setModels([]); setModelStatus(''); setLoadingModels(false)
    if (!draft.base_url.trim() || (!key.trim() && !canUseSavedKey)) return
    const controller = new AbortController()
    // Wait until typing pauses; cancel old responses when credentials change or the dialog closes.
    const timer = setTimeout(() => {
      setLoadingModels(true)
      void agentRequest<{ models: string[] }>('models', { draft: { ...draft, api_key: key } }, controller.signal).then((value) => {
        if (controller.signal.aborted) return
        setModels(value.models)
        setDraft((current) => current.model || !value.models.length ? current : { ...current, model: value.models[0] })
        setModelStatus(value.models.length
          ? (zh ? `已自动读取 ${value.models.length} 个模型。` : `Loaded ${value.models.length} models automatically.`)
          : (zh ? '服务商未返回模型，可选择已有预设。' : 'No models returned; existing presets remain available.'))
      }).catch((error) => {
        if (!controller.signal.aborted) setModelStatus((zh ? '自动读取失败，请检查 Key 和接口地址：' : 'Could not load models; check your key and API URL: ') + String(error))
      }).finally(() => { if (!controller.signal.aborted) setLoadingModels(false) })
    }, 800)
    return () => { clearTimeout(timer); controller.abort() }
  }, [draft.id, draft.provider, draft.base_url, key, canUseSavedKey, zh])
  function edit(change: Partial<Profile>) { setDraft({ ...draft, ...change }); setSaved(false); setStatus('') }
  async function run(action: () => Promise<void>) {
    setBusy(true); setStatus('')
    try { await action() } catch (e) { setStatus(String(e)) } finally { setBusy(false) }
  }
  async function save() {
    const value = await agentRequest<AgentConfig>('save', { ...draft, api_key: key })
    setConfig(value); select(value.profiles.find((p) => p.id === draft.id)!); onSaved()
    setStatus(t('已保存并启用。', 'Saved and activated.'))
  }
  return <div className="agent-settings-overlay" role="dialog" aria-modal="true" aria-label={t('Agent API 设置', 'Agent API settings')}>
    <section className="agent-settings">
      <header><h2>{t('Agent API 设置', 'Agent API settings')}</h2><button className="agent-close" aria-label={t('关闭', 'Close')} disabled={busy} onClick={onClose}>×</button></header>
      <div className="agent-settings-body">
      <p className="agent-intro">{t('选择服务商，填写你自己的 API Key 并选择模型。发送对话会将文字及场景数据提交到所选服务，并按该服务计费。', 'Choose a provider, enter your API key and select a model. Sending a message shares text and scene data with that provider and may incur API charges.')}</p>
      <fieldset disabled={busy || !config}>
        <label>{t('已保存配置', 'Saved profiles')}<select value={saved ? draft.id : ''} onChange={(e) => { const p = config?.profiles.find((p) => p.id === e.target.value); if (p) select(p) }}><option value="">{t('新建 / 未保存', 'New / unsaved')}</option>{config?.profiles.map((p) => <option key={p.id} value={p.id}>{p.name}{p.id === config.active_id ? ' ✓' : ''}</option>)}</select></label>
        <button onClick={() => { setDraft({ id: crypto.randomUUID(), name: '', provider: 'qwen-cn', base_url: config!.presets.find((p) => p.id === 'qwen-cn')!.base_url, model: 'qwen3.7-plus', has_key: false }); setKey(''); setSaved(false); setModels([]) }}>{t('新增配置', 'New profile')}</button>
        <label>{t('名称', 'Name')}<input value={draft.name} onChange={(e) => edit({ name: e.target.value })} /></label>
        <label>{t('服务商 / 地域', 'Provider / region')}<select value={draft.provider} onChange={(e) => { const p = config!.presets.find((p) => p.id === e.target.value)!; edit({ provider: p.id, base_url: p.base_url, model: p.id === 'qwen-cn' ? 'qwen3.7-plus' : '' }); setKey(''); setModels([]) }}>{config?.presets.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}</select></label>
        <label>Base URL<input value={draft.base_url} onChange={(e) => { edit({ base_url: e.target.value }); setKey(''); setModels([]) }} placeholder="https://…/v1" /></label>
        <label>API Key<input type="password" autoComplete="off" value={key} onChange={(e) => { setKey(e.target.value); setSaved(false) }} placeholder={draft.has_key ? t('已保存；留空保留，改地址需重新输入', 'Saved; leave blank to retain, re-enter for a new URL') : t('填写 API Key', 'Enter API key')} /></label>
        <label>{t('模型', 'Model')}<select value={draft.model} onChange={(e) => edit({ model: e.target.value })}><option value="" disabled>{t('填写 Key 后自动加载模型', 'Models load after entering a key')}</option>{choices.map((id) => <option key={id} value={id}>{id}</option>)}</select></label>
        <p>{t('填写 API Key 后会自动读取模型列表，再选择模型并保存。Qwen 北京提供常用预设，实际可用性以账号为准。Agent 需要支持工具调用的模型，可用“测试连接”验证。', 'Models load automatically after you enter your API key. Select a model and save. Beijing Qwen includes common presets; availability depends on your account. Use Test connection to verify tool calling support.')}</p>
        <div role="status">{loadingModels ? t('正在自动读取模型…', 'Loading models automatically…') : modelStatus}</div>

      </fieldset>
      <p className="agent-privacy">{t('Key 仅保存在 ComfyUI 机器的私有配置目录，Windows 下使用系统加密；不会写入工作流或导出文件。此浏览器保存访问配置的凭证，请勿分享浏览器数据。', 'Keys stay in a private directory on the ComfyUI machine, protected by Windows encryption on Windows. They are excluded from workflows and exports. This browser stores a configuration access token; do not share browser data.')}</p>
      </div>
      <footer className="agent-settings-footer">
        <div className="agent-settings-actions">
          <button className="agent-primary" disabled={busy || !config || !draft.model} onClick={() => void run(save)}>{t('保存并启用', 'Save and activate')}</button>
          <button disabled={busy || !saved} onClick={() => void run(async () => { const value = await agentRequest<AgentConfig>('activate', { profile_id: draft.id }); setConfig(value); onSaved(); setStatus(t('已切换配置', 'Profile activated')) })}>{t('切换到此配置', 'Activate')}</button>
          <button disabled={busy || !saved} onClick={() => void run(async () => { const result = await agentRequest<{ tool_calls: boolean }>('test', { profile_id: draft.id }); setStatus(result.tool_calls ? t('连接与工具调用验证通过。', 'Connection and tool call verified.') : t('连接成功，但模型未按要求调用工具，尚未验证 Agent 能力。', 'Connected, but the model did not call the test tool. Agent capability is unverified.')) })}>{t('测试连接（会调用 API）', 'Test connection (calls API)')}</button>
          <button className="agent-danger" disabled={busy || !saved} onClick={() => void run(async () => { const value = await agentRequest<AgentConfig>('delete', { id: draft.id }); setConfig(value); setDraft({ ...draft, id: crypto.randomUUID(), has_key: false }); setKey(''); setSaved(false); onSaved(); setStatus(t('已删除此配置与 Key。', 'Profile and key deleted.')) })}>{t('删除配置', 'Delete profile')}</button>
        </div>
      <div role="status">{busy ? t('处理中…', 'Working…') : status}</div>
      </footer>
    </section>
  </div>
}
