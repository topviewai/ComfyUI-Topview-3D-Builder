import { useState } from 'react'

const repository = 'https://github.com/topviewai/topview-3d-builder'
const installation = "Install the Topview 3D Builder plugin from https://github.com/topviewai/topview-3d-builder for the agent I'm using (Qoder, Claude Code, Cursor or another agent with skills support). Follow the install steps in the README, then tell me when to restart."

export function AgentGuide({locale,expanded,onToggle}:{locale:string;expanded:boolean;onToggle:()=>void}) {
  const zh=locale.startsWith('zh')
  const [status,setStatus]=useState('')
  async function copy() {
    try { await navigator.clipboard.writeText(installation); setStatus(zh?'已复制，粘贴给你的 Agent 即可。':'Copied. Paste this into your agent.') }
    catch { setStatus(zh?'请展开下方安装指令，选中并复制。':'Expand the instructions below and copy the text.') }
  }
  return <aside className={`agent-guide${expanded ? '' : ' is-collapsed'}`} aria-label={zh?'AI Agent 使用指南':'AI Agent guide'}>
    <header><span className="agent-guide-badge">AI</span><h2>{expanded ? (zh?'让 Agent 帮你搭建 3D 场景':'Build 3D scenes with your agent') : (zh?'使用 Agent 创作':'Create with Agent')}</h2><button className="agent-guide-toggle" onClick={onToggle} aria-expanded={expanded} aria-controls="agent-guide-content">{expanded ? (zh?'收起 ▾':'Collapse ▾') : (zh?'展开 ▴':'Expand ▴')}</button></header>
    <div id="agent-guide-content" hidden={!expanded}>
    <p>{zh?'想通过对话搭建场景？前往 Topview 3D Builder 仓库，将插件安装到 Qoder、Claude Code、Cursor 或其他支持 Skills 的 Agent。':'Visit the Topview 3D Builder repository and install the plugin in Qoder, Claude Code, Cursor, or another agent with skills support.'}</p>
    <div className="agent-guide-actions"><a href={repository} target="_blank" rel="noopener noreferrer">{zh?'查看 GitHub 仓库 ↗':'View repository ↗'}</a><button onClick={() => void copy()}>{zh?'复制安装指令':'Copy install instructions'}</button></div>
    <details><summary>{zh?'查看安装指令':'Installation instructions'}</summary><textarea aria-label={zh?'安装指令':'Install instructions'} readOnly value={installation} onFocus={event=>event.target.select()} /></details>
    <div role="status">{status}</div>
    </div>
  </aside>
}
