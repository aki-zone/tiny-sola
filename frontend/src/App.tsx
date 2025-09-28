import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import './App.css'

const API_BASE = import.meta.env.VITE_API_BASE || 'http://localhost:8000'

const LOG_LIMIT = 30

const timeFormatter = new Intl.DateTimeFormat('zh-CN', {
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
})
const healthTimeFormatter = new Intl.DateTimeFormat('zh-CN', {
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
})

type HealthDetails = {
  ffmpeg: {
    available: boolean
    path: string | null
  }
  piper: {
    binary_available: boolean
    binary_path: string | null
    model_available: boolean
    model_path: string
  }
  ollama: {
    available: boolean
    host: string
    model: string
    error: string | null
  }
}

type HealthResponse = {
  status: 'ok' | 'degraded'
  timestamp: string
  details: HealthDetails
}

type HealthState = {
  phase: 'loading' | 'ready' | 'error'
  data: HealthResponse | null
  error: string | null
}

type Status = 'idle' | 'recording' | 'uploading' | 'reply_ready' | 'error'

type StatusVisual = {
  label: string
  tone: 'neutral' | 'active' | 'loading' | 'success' | 'error'
  hint: string
}

type LogTone = 'info' | 'warn' | 'error'

type LogEntry = {
  id: string
  text: string
  tone: LogTone
  timestamp: string
}

type ConversationMessage = {
  role: 'user' | 'assistant'
  content: string
}

type RoleSkillInfo = {
  id: string
  name: string
  description: string
  requires_user_input: boolean
  placeholder?: string | null
}

type RoleInfo = {
  id: string
  name: string
  alias?: string | null
  tagline?: string | null
  summary?: string | null
  background?: string | null
  style?: string | null
  knowledge_focus: string[]
  sample_questions: string[]
  skills: RoleSkillInfo[]
}

type SkillResult = {
  id: string
  roleId: string
  roleName: string
  skillId: string
  skillName: string
  text: string
  timestamp: string
}

const STATUS_MAP: Record<Status, StatusVisual> = {
  idle: {
    label: '准备就绪',
    tone: 'neutral',
    hint: '点击按钮选择角色后开始录音对话。',
  },
  recording: {
    label: '录音中...',
    tone: 'active',
    hint: '录音进行中，请保持距离和语速。',
  },
  uploading: {
    label: '解析中...',
    tone: 'loading',
    hint: '后端正在解析音频，请稍后。',
  },
  reply_ready: {
    label: '回复已更新',
    tone: 'success',
    hint: '始终保持角色说话样式，可以接下来录音或使用技能。',
  },
  error: {
    label: '已停止, 发生错误',
    tone: 'error',
    hint: '请根据提示排查问题后再试。',
  },
}

const WORKFLOW_STEPS = [
  '选择角色',
  '录音',
  '语音识别',
  '角色回复',
  '语音合成',
]

function createLogId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return (crypto as Crypto).randomUUID()
  }
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`
}

export default function App() {
  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const audioChunksRef = useRef<Blob[]>([])
  const conversationRef = useRef<ConversationMessage[]>([])

  const [isRecording, setIsRecording] = useState(false)
  const [status, setStatus] = useState<Status>('idle')
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const [logs, setLogs] = useState<LogEntry[]>([])
  const [lastReplyText, setLastReplyText] = useState('')
  const [lastTranscription, setLastTranscription] = useState('')
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'failed'>('idle')

  const [health, setHealth] = useState<HealthState>({
    phase: 'loading',
    data: null,
    error: null,
  })
  const [healthRefreshing, setHealthRefreshing] = useState(false)

  const [roles, setRoles] = useState<RoleInfo[]>([])
  const [defaultRoleId, setDefaultRoleId] = useState<string | null>(null)
  const [selectedRoleId, setSelectedRoleId] = useState<string | null>(null)
  const [roleSearch, setRoleSearch] = useState('')
  const [conversation, setConversation] = useState<ConversationMessage[]>([])
  const [skillResults, setSkillResults] = useState<SkillResult[]>([])
  const [skillInputs, setSkillInputs] = useState<Record<string, string>>({})
  const [skillLoading, setSkillLoading] = useState<Record<string, boolean>>({})
  const [skillError, setSkillError] = useState<string | null>(null)

  const statusInfo = STATUS_MAP[status]
  const isHealthLoading = health.phase === 'loading'
  const isHealthRefreshing = healthRefreshing

  const pushLog = useCallback((text: string, tone: LogTone = 'info') => {
    const entry: LogEntry = {
      id: createLogId(),
      text,
      tone,
      timestamp: timeFormatter.format(new Date()),
    }
    setLogs((prev) => [entry, ...prev].slice(0, LOG_LIMIT))
  }, [])

  const loadHealth = useCallback(async () => {
    setHealth((prev) => ({
      phase: prev.data ? 'ready' : 'loading',
      data: prev.data,
      error: null,
    }))
    setHealthRefreshing(true)
    try {
      const response = await fetch(`${API_BASE}/health`)
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`)
      }
      const data: HealthResponse = await response.json()
      setHealth({ phase: 'ready', data, error: null })
    } catch (error) {
      const message = error instanceof Error ? error.message : '未知错误'
      setHealth((prev) => ({
        phase: prev.data ? 'ready' : 'error',
        data: prev.data,
        error: message,
      }))
      pushLog(`健康检查失败: ${message}`, 'warn')
    } finally {
      setHealthRefreshing(false)
    }
  }, [pushLog])

  const loadRoles = useCallback(async () => {
    try {
      const response = await fetch(`${API_BASE}/roles`)
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`)
      }
      const payload = await response.json()
      const fetchedRoles: RoleInfo[] = payload.roles || []
      setRoles(fetchedRoles)
      const defaultId: string | null = payload.default_role_id || null
      setDefaultRoleId(defaultId)
      setSelectedRoleId((prev) => prev || defaultId || (fetchedRoles[0]?.id ?? null))
      pushLog(`已加载 ${fetchedRoles.length} 位角色`)
    } catch (error) {
      const message = error instanceof Error ? error.message : '未知错误'
      setErrorMsg(`角色列表加载失败: ${message}`)
      pushLog(`加载角色失败: ${message}`, 'error')
    }
  }, [pushLog])

  useEffect(() => {
    return () => {
      if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
        mediaRecorderRef.current.stop()
      }
    }
  }, [])

  useEffect(() => {
    loadHealth()
    loadRoles()
  }, [loadHealth, loadRoles])

  useEffect(() => {
    if (copyState === 'idle') {
      return
    }
    const timer = window.setTimeout(() => setCopyState('idle'), 2000)
    return () => window.clearTimeout(timer)
  }, [copyState])

  useEffect(() => {
    if (!lastReplyText) {
      setCopyState('idle')
    }
  }, [lastReplyText])

  useEffect(() => {
    conversationRef.current = conversation
  }, [conversation])

  useEffect(() => {
    function handleGlobalShortcut(event: KeyboardEvent) {
      if (event.repeat || event.altKey || event.ctrlKey || event.metaKey) {
        return
      }
      const target = event.target as HTMLElement | null
      if (target) {
        const tagName = target.tagName
        const isEditable = target.isContentEditable || tagName === 'INPUT' || tagName === 'TEXTAREA' || tagName === 'SELECT'
        if (isEditable) {
          return
        }
        if (target.closest && target.closest('button,[role="button"]')) {
          return
        }
      }

      if ((event.code === 'Space' || event.key === ' ') && selectedRoleId) {
        event.preventDefault()
        if (status === 'uploading') {
          return
        }
        if (isRecording) {
          stopRecording()
        } else {
          startRecording()
        }
      }
    }

    window.addEventListener('keydown', handleGlobalShortcut)
    return () => window.removeEventListener('keydown', handleGlobalShortcut)
  }, [isRecording, selectedRoleId, status])

  const selectedRole = useMemo(() => roles.find((role) => role.id === selectedRoleId) || null, [roles, selectedRoleId])

  const filteredRoles = useMemo(() => {
    const term = roleSearch.trim().toLowerCase()
    if (!term) {
      return roles
    }
    return roles.filter((role) => {
      const haystack = [
        role.name,
        role.alias ?? '',
        role.tagline ?? '',
        role.summary ?? '',
        role.background ?? '',
        role.style ?? '',
        (role.knowledge_focus || []).join(' '),
      ]
        .join(' ')
        .toLowerCase()
      return haystack.includes(term)
    })
  }, [roles, roleSearch])

  const selectedRoleName = selectedRole?.name || '角色'
  const selectedRoleSkills = selectedRole?.skills ?? []
  const hasConversation = conversation.length > 0
  const hasSkillResults = skillResults.length > 0
  const canCopy = lastReplyText.length > 0
  const recordButtonDisabled = status === 'uploading' || isHealthLoading || !selectedRoleId
  const recordButtonLabel = isRecording ? '停止录音' : status === 'uploading' ? '解析中...' : '开始录音'
  const recordButtonClass = `record-btn ${isRecording ? 'is-recording' : ''}`

  const isHealthOk = health.data?.status === 'ok'
  const healthTone = isHealthOk ? 'ok' : 'warn'
  const healthLabel = isHealthOk ? '服务可用' : '部分功能待检'
  const healthTimestamp = health.data ? healthTimeFormatter.format(new Date(health.data.timestamp)) : ''
  const healthDetailItems = health.data
    ? [
        {
          key: 'ffmpeg',
          label: 'ffmpeg',
          ok: health.data.details.ffmpeg.available,
          text: health.data.details.ffmpeg.available ? '可用' : '未找到',
        },
        {
          key: 'piper',
          label: 'Piper',
          ok: health.data.details.piper.binary_available && health.data.details.piper.model_available,
          text: health.data.details.piper.binary_available
            ? health.data.details.piper.model_available
              ? '语音合成就绪'
              : '缺少语音模型'
            : '缺少执行程序',
        },
        {
          key: 'ollama',
          label: 'LLM',
          ok: health.data.details.ollama.available,
          text: health.data.details.ollama.available
            ? `模型 ${health.data.details.ollama.model}`
            : '未连接',
        },
      ]
    : []
  const healthError = health.error
  const refreshButtonLabel = isHealthRefreshing ? '检测中...' : '重新检测'
  const healthPlaceholder = isHealthLoading ? '正在检测...' : healthError ? '检查失败, 请稍后重试' : '等待健康数据'

  async function startRecording() {
    setErrorMsg(null)
    if (!selectedRoleId) {
      setStatus('error')
      setErrorMsg('请先在左侧选择一位角色。')
      pushLog('未选择角色, 无法开始录音', 'warn')
      return
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const recorder = new MediaRecorder(stream)
      audioChunksRef.current = []
      const roleIdAtStart = selectedRoleId

      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          audioChunksRef.current.push(event.data)
        }
      }

      recorder.onstop = async () => {
        setIsRecording(false)
        setStatus('uploading')
        const blob = new Blob(audioChunksRef.current, { type: 'audio/webm' })
        await sendToTalk(blob, roleIdAtStart)
        stream.getTracks().forEach((track) => track.stop())
        mediaRecorderRef.current = null
      }

      recorder.start()
      mediaRecorderRef.current = recorder
      setIsRecording(true)
      setStatus('recording')
      pushLog(`录音开始 -> ${selectedRoleName}`)
    } catch (error) {
      const message = error instanceof Error ? error.message : '无法访问麦克风'
      pushLog(`麦克风访问失败: ${message}`, 'error')
      setErrorMsg('请检查浏览器麦克风权限后重试。')
      setStatus('error')
    }
  }

  function stopRecording() {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop()
      pushLog('已停止录音, 准备上传...')
    }
  }

  async function sendToTalk(blob: Blob, roleId: string | null) {
    if (!roleId) {
      setStatus('error')
      setErrorMsg('未找到选中的角色。')
      pushLog('未找到选中角色, /talk 被中止', 'error')
      return
    }

    pushLog('上传音频中...')
    const form = new FormData()
    form.append('file', blob, 'audio.webm')
    form.append('role_id', roleId)
    form.append('history', JSON.stringify(conversationRef.current.slice(-8)))

    try {
      const response = await fetch(`${API_BASE}/talk`, {
        method: 'POST',
        body: form,
      })

      if (!response.ok) {
        throw new Error(`接口返回 ${response.status}`)
      }

      const data = await response.json()
      const transcription: string = data.transcription || ''
      const replyText: string = data.reply_text || ''
      const audioBase64: string | undefined = data.reply_audio_base64
      const role = roles.find((item) => item.id === roleId)
      const roleLabel = role?.name || '角色'

      pushLog(`ASR: ${transcription || '(无文本)'}`)
      pushLog(`${roleLabel}: ${replyText || '(无回复)'}`)
      setLastReplyText(replyText)
      setLastTranscription(transcription)
      setConversation((prev) => {
        const next = [...prev, { role: 'user', content: transcription }, { role: 'assistant', content: replyText }]
        conversationRef.current = next
        return next
      })

      if (audioBase64) {
        const audio = new Audio(`data:audio/wav;base64,${audioBase64}`)
        audio.play().catch(() => {
          pushLog('音频播放失败(可能被浏览器拦截)', 'warn')
        })
      }

      setStatus('reply_ready')
    } catch (error) {
      const message = error instanceof Error ? error.message : '未知错误'
      setStatus('error')
      setErrorMsg(`调用失败: ${message}`)
      pushLog('调用 /talk 失败', 'error')
    }
  }

  async function handleCopyReply() {
    if (!lastReplyText) {
      return
    }
    try {
      await navigator.clipboard.writeText(lastReplyText)
      setCopyState('copied')
      pushLog('已复制最新回复')
    } catch (_error) {
      setCopyState('failed')
      pushLog('复制回复时遇到问题', 'warn')
    }
  }

  function handleResetConversation() {
    setConversation([])
    conversationRef.current = []
    setLastReplyText('')
    setLastTranscription('')
    pushLog('已清空本次对话')
  }

  function handleClearLogs() {
    setLogs([])
  }

  function handleRoleSearchChange(event: React.ChangeEvent<HTMLInputElement>) {
    setRoleSearch(event.target.value)
  }

  function handleSelectRole(roleId: string) {
    if (roleId === selectedRoleId) {
      return
    }
    const role = roles.find((item) => item.id === roleId)
    setSelectedRoleId(roleId)
    setSkillInputs({})
    setSkillResults([])
    setSkillError(null)
    handleResetConversation()
    setStatus('idle')
    if (role) {
      pushLog(`已切换到 ${role.name}`)
    }
  }

  function handleSkillInputChange(skillId: string, value: string) {
    setSkillInputs((prev) => ({ ...prev, [skillId]: value }))
  }

  function handleClearSkillResults() {
    setSkillResults([])
    pushLog('已清空技能输出')
  }

  async function handleInvokeSkill(skill: RoleSkillInfo) {
    if (!selectedRoleId || !selectedRole) {
      setSkillError('请先选择一位角色。')
      pushLog('未选择角色时在执行技能', 'warn')
      return
    }
    const input = skillInputs[skill.id]?.trim()
    if (skill.requires_user_input && !input) {
      setSkillError('请先填写这个技能需要的内容。')
      return
    }

    setSkillError(null)
    setSkillLoading((prev) => ({ ...prev, [skill.id]: true }))
    pushLog(`执行技能 -> ${selectedRole.name}: ${skill.name}`)

    try {
      const response = await fetch(`${API_BASE}/roles/${selectedRoleId}/skills/${skill.id}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          input_text: input,
          history: conversationRef.current.slice(-8),
          speak: false,
        }),
      })
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`)
      }
      const data = await response.json()
      const replyText: string = data.text || ''
      setSkillResults((prev) => {
        const entry: SkillResult = {
          id: createLogId(),
          roleId: selectedRoleId,
          roleName: selectedRole.name,
          skillId: skill.id,
          skillName: skill.name,
          text: replyText,
          timestamp: timeFormatter.format(new Date()),
        }
        return [entry, ...prev]
      })
      setSkillInputs((prev) => ({ ...prev, [skill.id]: skill.requires_user_input ? '' : prev[skill.id] }))
      pushLog(`技能返回 -> ${skill.name}`)
    } catch (error) {
      const message = error instanceof Error ? error.message : '未知错误'
      setSkillError(`执行技能失败: ${message}`)
      pushLog(`执行技能出错: ${message}`, 'error')
    } finally {
      setSkillLoading((prev) => ({ ...prev, [skill.id]: false }))
    }
  }

  return (
    <div className="app">
      <div className="app__shell">
        <header className="app__header">
          <span className="app__badge">Role-play</span>
          <h1 className="app__title">tiny-sola 角色聊天</h1>
          <p className="app__subtitle">{selectedRole ? `${selectedRole.name} 正等你开发语音对话和技能交互` : '请选择一位角色开始聊天'}</p>
          <div className="health-banner" role="status" aria-live="polite">
            <div className="health-banner__summary">
              <span className={`health-banner__pill health-banner__pill--${healthTone}`}>
                {healthLabel}
              </span>
              {healthTimestamp && (
                <span className="health-banner__timestamp">最近检测 {healthTimestamp}</span>
              )}
              {healthError && (
                <span className="health-banner__error">{healthError}</span>
              )}
            </div>
            <div className="health-banner__details">
              {healthDetailItems.length ? (
                healthDetailItems.map((item) => (
                  <div
                    key={item.key}
                    className={`health-banner__detail ${item.ok ? 'is-ok' : 'is-warn'}`}
                  >
                    <span className="health-banner__detail-label">{item.label}</span>
                    <span className="health-banner__detail-value">{item.text}</span>
                  </div>
                ))
              ) : (
                <span className="health-banner__placeholder">{healthPlaceholder}</span>
              )}
            </div>
            <button
              type="button"
              className="ghost-btn ghost-btn--compact"
              onClick={loadHealth}
              disabled={isHealthRefreshing}
            >
              {refreshButtonLabel}
            </button>
          </div>
          <ol className="workflow" aria-label="workflow">
            {WORKFLOW_STEPS.map((step, index) => (
              <li className="workflow__item" key={step}>
                <span className="workflow__index">{String(index + 1).padStart(2, '0')}</span>
                <span className="workflow__label">{step}</span>
              </li>
            ))}
          </ol>
        </header>

        <main className="app__main">
          <div className="layout">
            <aside className="layout__sidebar">
              <section className="card">
                <div className="card__header">
                  <div className="card__title-group">
                    <h2 className="card__title">搜索角色</h2>
                    <p className="card__subtitle">输入关键词找到喜爱的聊天对象</p>
                  </div>
                </div>
                <input
                  type="search"
                  className="input"
                  placeholder="搜索名字、背景或专长"
                  value={roleSearch}
                  onChange={handleRoleSearchChange}
                />
              </section>

              <section className="card role-list-card">
                <div className="card__header">
                  <div className="card__title-group">
                    <h2 className="card__title">角色列表</h2>
                    <p className="card__subtitle">点击选择并立即开始对话</p>
                  </div>
                </div>
                <ul className="role-list">
                  {filteredRoles.length ? (
                    filteredRoles.map((role) => {
                      const isActive = role.id === selectedRoleId
                      return (
                        <li key={role.id} className={`role-list__item ${isActive ? 'is-active' : ''}`}>
                          <button type="button" className="role-card" onClick={() => handleSelectRole(role.id)}>
                            <div className="role-card__header">
                              <span className="role-card__name">{role.name}</span>
                              {role.tagline && <span className="role-card__tagline">{role.tagline}</span>}
                            </div>
                            {role.summary && <p className="role-card__summary">{role.summary}</p>}
                            {role.knowledge_focus?.length ? (
                              <ul className="role-card__focus">
                                {role.knowledge_focus.map((topic) => (
                                  <li key={topic}>{topic}</li>
                                ))}
                              </ul>
                            ) : null}
                          </button>
                        </li>
                      )
                    })
                  ) : (
                    <li className="role-list__placeholder">未找到相关角色</li>
                  )}
                </ul>
              </section>

              {selectedRole && (
                <section className="card role-detail-card">
                  <div className="card__header">
                    <div className="card__title-group">
                      <h2 className="card__title">{selectedRole.name}</h2>
                      {selectedRole.alias && <p className="card__subtitle">{selectedRole.alias}</p>}
                    </div>
                  </div>
                  {selectedRole.background && <p className="role-detail__paragraph">{selectedRole.background}</p>}
                  {selectedRole.style && (
                    <p className="role-detail__paragraph role-detail__paragraph--muted">表达风格: {selectedRole.style}</p>
                  )}
                  {selectedRole.sample_questions?.length ? (
                    <div className="role-detail__block">
                      <h3 className="role-detail__heading">建议提问</h3>
                      <ul className="bullet-list">
                        {selectedRole.sample_questions.map((item) => (
                          <li key={item}>{item}</li>
                        ))}
                      </ul>
                    </div>
                  ) : null}
                  <button type="button" className="ghost-btn" onClick={handleResetConversation} disabled={!hasConversation}>
                    重置对话
                  </button>
                </section>
              )}
            </aside>

            <div className="layout__main">
              <section className="card card--primary">
                <div className="card__header">
                  <div className="card__title-group">
                    <h2 className="card__title">实时录音</h2>
                    <p className="card__subtitle">{statusInfo.hint}</p>
                  </div>
                  <span className={`status-chip status-chip--${statusInfo.tone}`}>
                    {statusInfo.label}
                  </span>
                </div>
                <div className="recorder">
                  <button
                    type="button"
                    className={recordButtonClass}
                    onClick={isRecording ? stopRecording : startRecording}
                    aria-pressed={isRecording}
                    aria-busy={status === 'uploading'}
                    disabled={recordButtonDisabled}
                  >
                    <span className="record-btn__icon" aria-hidden="true" />
                    {recordButtonLabel}
                  </button>
                  <p className="recorder__hint">
                    {!selectedRoleId
                      ? '请先在左侧选择一位角色，然后点击开始录音。'
                      : isRecording
                        ? '录音进行中, 点击按钮结束并自动解析。可以按下空格键快捷结束.'
                        : status === 'uploading'
                          ? '正在解析语音, 请稍后。'
                          : '点击按钮授权麦克风并开始录音, 或按下空格键。'}
                  </p>
                </div>
              </section>

              <section className="card conversation-card">
                <div className="card__header">
                  <div className="card__title-group">
                    <h2 className="card__title">对话时间线</h2>
                    <p className="card__subtitle">记录你与 {selectedRoleName} 的当前交互</p>
                  </div>
                  <div className="card__actions">
                    <button type="button" className="ghost-btn" onClick={handleCopyReply} disabled={!canCopy}>
                      {copyState === 'copied' ? '已复制' : copyState === 'failed' ? '复制失败' : '复制最新回复'}
                    </button>
                    <button type="button" className="ghost-btn" onClick={handleResetConversation} disabled={!hasConversation}>
                      清空
                    </button>
                  </div>
                </div>
                <ul className="conversation-list" aria-live="polite">
                  {conversation.length ? (
                    conversation.map((msg, index) => (
                      <li key={`${msg.role}-${index}-${msg.content.slice(0, 8)}`} className={`conversation-item conversation-item--${msg.role}`}>
                        <span className="conversation-item__role">{msg.role === 'user' ? '用户' : selectedRoleName}</span>
                        <p className="conversation-item__text">{msg.content}</p>
                      </li>
                    ))
                  ) : (
                    <li className="conversation-list__placeholder">等待首次录音或查看技能输出。</li>
                  )}
                </ul>
              </section>

              <section className="card skills-card">
                <div className="card__header">
                  <div className="card__title-group">
                    <h2 className="card__title">角色技能</h2>
                    <p className="card__subtitle">在回复之外, 角色可以提供通过 LLM 构造的深度赋能</p>
                  </div>
                </div>
                {skillError && <p className="form-error">{skillError}</p>}
                <ul className="skill-list">
                  {selectedRoleSkills.length ? (
                    selectedRoleSkills.map((skill) => {
                      const loading = skillLoading[skill.id]
                      return (
                        <li key={skill.id} className="skill-list__item">
                          <div className="skill-list__header">
                            <div>
                              <h3 className="skill-list__name">{skill.name}</h3>
                              <p className="skill-list__description">{skill.description}</p>
                            </div>
                            <button
                              type="button"
                              className="ghost-btn ghost-btn--accent"
                              onClick={() => handleInvokeSkill(skill)}
                              disabled={loading}
                            >
                              {loading ? '执行中...' : '即刻执行'}
                            </button>
                          </div>
                          {skill.requires_user_input && (
                            <textarea
                              className="input input--textarea"
                              value={skillInputs[skill.id] ?? ''}
                              placeholder={skill.placeholder ?? '输入您想要解答的问题'}
                              onChange={(event) => handleSkillInputChange(skill.id, event.target.value)}
                            />
                          )}
                        </li>
                      )
                    })
                  ) : (
                    <li className="skill-list__placeholder">请选择角色后查看可用技能</li>
                  )}
                </ul>
              </section>

              <section className="card skill-result-card">
                <div className="card__header">
                  <div className="card__title-group">
                    <h2 className="card__title">技能输出</h2>
                    <p className="card__subtitle">保存 AI 角色为你提供的短文或项目</p>
                  </div>
                  <button type="button" className="ghost-btn" onClick={handleClearSkillResults} disabled={!hasSkillResults}>
                    清空
                  </button>
                </div>
                <ul className="skill-result-list" aria-live="polite">
                  {skillResults.length ? (
                    skillResults.map((item) => (
                      <li key={item.id} className="skill-result">
                        <div className="skill-result__meta">
                          <span className="skill-result__skill">{item.skillName}</span>
                          <span className="skill-result__timestamp">{item.timestamp}</span>
                        </div>
                        <p className="skill-result__text">{item.text}</p>
                      </li>
                    ))
                  ) : (
                    <li className="skill-result-list__placeholder">暂无数据, 尝试执行上方的技能按钮。</li>
                  )}
                </ul>
              </section>

              <section className="card card--logs">
                <div className="card__header">
                  <div className="card__title-group">
                    <h2 className="card__title">调用日志</h2>
                    <p className="card__subtitle">查看每次录音、技能执行的详细记录</p>
                  </div>
                  <button type="button" className="ghost-btn" onClick={handleClearLogs} disabled={logs.length === 0}>
                    清空
                  </button>
                </div>
                <ul className="log-list">
                  {logs.length ? (
                    logs.map((entry) => (
                      <li key={entry.id} className={`log-item log-item--${entry.tone}`}>
                        <span className="log-item__time">{entry.timestamp}</span>
                        <span className="log-item__text">{entry.text}</span>
                      </li>
                    ))
                  ) : (
                    <li className="log-list__placeholder">暂无日志, 等待交互记录。</li>
                  )}
                </ul>
              </section>
            </div>
          </div>
        </main>

        {(errorMsg || copyState === 'copied' || copyState === 'failed') && (
          <div className="toast-stack">
            {errorMsg && (
              <div className="toast toast--error" role="alert">
                {errorMsg}
              </div>
            )}
            {copyState === 'copied' && !errorMsg && (
              <div className="toast toast--success" role="status">
                已复制到剪切板
              </div>
            )}
            {copyState === 'failed' && !errorMsg && (
              <div className="toast toast--warn" role="alert">
                复制失败, 可按 “Ctrl+C” 手动复制
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
