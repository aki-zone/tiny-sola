import React, { useEffect, useRef, useState } from 'react'
import './App.css'

const API_BASE = import.meta.env.VITE_API_BASE || 'http://localhost:8000'

const LOG_LIMIT = 30

const timeFormatter = new Intl.DateTimeFormat('zh-CN', {
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
})

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

const STATUS_MAP: Record<Status, StatusVisual> = {
  idle: {
    label: '\u51c6\u5907\u5c31\u7eea',
    tone: 'neutral',
    hint: '\u70b9\u51fb\u6309\u94ae\u5f00\u59cb\u7b2c\u4e00\u6bb5\u5f55\u97f3\u3002',
  },
  recording: {
    label: '\u5f55\u97f3\u4e2d...',
    tone: 'active',
    hint: '\u5f55\u97f3\u8fdb\u884c\u4e2d\uff0c\u8bf7\u4fdd\u6301\u8ddd\u79bb\u548c\u8bed\u901f\u3002',
  },
  uploading: {
    label: '\u89e3\u6790\u4e2d...',
    tone: 'loading',
    hint: '\u540e\u7aef\u6b63\u5728\u89e3\u6790\u97f3\u9891\uff0c\u8bf7\u7b49\u5f85\u7247\u523b\u3002',
  },
  reply_ready: {
    label: '\u56de\u590d\u5df2\u66f4\u65b0',
    tone: 'success',
    hint: '\u4e0b\u65b9\u5df2\u5c55\u793a\u6700\u65b0\u56de\u590d\uff0c\u53ef\u590d\u5236\u6216\u7ee7\u7eed\u5f55\u97f3\u3002',
  },
  error: {
    label: '\u5df2\u505c\u6b62, \u53d1\u751f\u9519\u8bef',
    tone: 'error',
    hint: '\u8bf7\u6839\u636e\u63d0\u793a\u6392\u67e5\u95ee\u9898\u540e\u518d\u6b21\u5c1d\u8bd5\u3002',
  },
}

const WORKFLOW_STEPS = [
  '\u5f55\u97f3',
  '\u8bed\u97f3\u8bc6\u522b',
  '\u5927\u6a21\u578b\u56de\u590d',
  '\u8bed\u97f3\u5408\u6210',
  '\u64ad\u653e',
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
  const [isRecording, setIsRecording] = useState(false)
  const [status, setStatus] = useState<Status>('idle')
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const [logs, setLogs] = useState<LogEntry[]>([])
  const [lastReplyText, setLastReplyText] = useState('')
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'failed'>('idle')

  useEffect(() => {
    return () => {
      if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
        mediaRecorderRef.current.stop()
      }
    }
  }, [])

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

  function pushLog(text: string, tone: LogTone = 'info') {
    const entry: LogEntry = {
      id: createLogId(),
      text,
      tone,
      timestamp: timeFormatter.format(new Date()),
    }
    setLogs((prev) => [entry, ...prev].slice(0, LOG_LIMIT))
  }

  async function startRecording() {
    setErrorMsg(null)
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const recorder = new MediaRecorder(stream)
      audioChunksRef.current = []

      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          audioChunksRef.current.push(event.data)
        }
      }

      recorder.onstop = async () => {
        setIsRecording(false)
        setStatus('uploading')
        const blob = new Blob(audioChunksRef.current, { type: 'audio/webm' })
        await sendToTalk(blob)
        stream.getTracks().forEach((track) => track.stop())
        mediaRecorderRef.current = null
      }

      recorder.start()
      mediaRecorderRef.current = recorder
      setIsRecording(true)
      setStatus('recording')
      pushLog('\u5f00\u59cb\u5f55\u97f3')
    } catch (error) {
      const message = error instanceof Error ? error.message : '\u65e0\u6cd5\u8bbf\u95ee\u9ea6\u514b\u98ce'
      pushLog(`\u9ea6\u514b\u98ce\u8bbf\u95ee\u5931\u8d25: ${message}`, 'error')
      setErrorMsg('\u8bf7\u68c0\u67e5\u6d4f\u89c8\u5668\u9ea6\u514b\u98ce\u6743\u9650\u8bbe\u7f6e\u540e\u91cd\u8bd5\u3002')
      setStatus('error')
    }
  }

  function stopRecording() {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop()
      pushLog('\u5df2\u505c\u6b62\u5f55\u97f3, \u51c6\u5907\u4e0a\u4f20...')
    }
  }

  async function sendToTalk(blob: Blob) {
    pushLog('\u4e0a\u4f20\u97f3\u9891\u4e2d...')
    const form = new FormData()
    form.append('file', blob, 'audio.webm')

    try {
      const response = await fetch(`${API_BASE}/talk`, {
        method: 'POST',
        body: form,
      })

      if (!response.ok) {
        throw new Error(`\u63a5\u53e3\u8fd4\u56de ${response.status}`)
      }

      const data = await response.json()
      const transcription: string = data.transcription || ''
      const replyText: string = data.reply_text || ''
      const audioBase64: string | undefined = data.reply_audio_base64

      pushLog(`LLM: ${replyText || '(\u7a7a)'}`)
      pushLog(`ASR: ${transcription || '(\u7a7a)'}`)
      setLastReplyText(replyText)

      if (audioBase64) {
        const audio = new Audio(`data:audio/wav;base64,${audioBase64}`)
        audio.play().catch(() => {
          pushLog('\u97f3\u9891\u64ad\u653e\u5931\u8d25(\u53ef\u80fd\u88ab\u6d4f\u89c8\u5668\u62e6\u622a)', 'warn')
        })
      }

      setStatus('reply_ready')
    } catch (error) {
      const message = error instanceof Error ? error.message : '\u672a\u77e5\u9519\u8bef'
      setStatus('error')
      setErrorMsg(`\u8c03\u7528\u63a5\u53e3\u5931\u8d25: ${message}`)
      pushLog('\u8c03\u7528 /talk \u5931\u8d25', 'error')
    }
  }

  async function handleCopyReply() {
    if (!lastReplyText) {
      return
    }
    try {
      await navigator.clipboard.writeText(lastReplyText)
      setCopyState('copied')
      pushLog('\u5df2\u590d\u5236\u6700\u65b0\u56de\u590d')
    } catch (_error) {
      setCopyState('failed')
      pushLog('\u590d\u5236\u56de\u590d\u65f6\u9047\u5230\u95ee\u9898', 'warn')
    }
  }

  function handleClearReply() {
    setLastReplyText('')
    setCopyState('idle')
  }

  function handleClearLogs() {
    setLogs([])
  }

  const statusInfo = STATUS_MAP[status]
  const canCopy = Boolean(lastReplyText)
  const copyLabelMap = {
    idle: '\u590d\u5236',
    copied: '\u5df2\u590d\u5236',
    failed: '\u91cd\u8bd5\u590d\u5236',
  }
  const copyLabel = copyLabelMap[copyState]
  const recordButtonLabel = isRecording
    ? '\u505c\u6b62\u5f55\u97f3'
    : status === 'uploading'
      ? '\u5904\u7406\u4e2d...'
      : '\u5f00\u59cb\u5f55\u97f3'
  const recordButtonClass = [
    'record-btn',
    isRecording ? 'record-btn--stop' : '',
    isRecording ? 'record-btn--live' : '',
    !isRecording && status === 'uploading' ? 'record-btn--waiting' : '',
  ]
    .filter(Boolean)
    .join(' ')
  const recordButtonDisabled = !isRecording && status === 'uploading'

  return (
    <div className="app">
      <div className="app__shell">
        <header className="app__header">
          <span className="app__badge">MVP</span>
          <h1 className="app__title">tiny-sola \u5bf9\u8bdd\u9762\u677f</h1>
          <p className="app__subtitle">{statusInfo.hint}</p>
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
          <section className="card card--primary">
            <div className="card__header">
              <div className="card__title-group">
                <h2 className="card__title">\u5b9e\u65f6\u5f55\u97f3</h2>
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
                {isRecording
                  ? '\u5f55\u97f3\u8fdb\u884c\u4e2d, \u70b9\u51fb\u6309\u94ae\u7ed3\u675f\u5e76\u81ea\u52a8\u89e3\u6790\u3002'
                  : status === 'uploading'
                    ? '\u6b63\u5728\u4e0a\u4f20\u5e76\u8fdb\u884c\u8bed\u97f3\u8bc6\u522b, \u8bf7\u7a0d\u5019\u3002'
                    : '\u70b9\u51fb\u6309\u94ae\u6388\u6743\u9ea6\u514b\u98ce\u5e76\u5f00\u59cb\u5f55\u97f3\u3002'}
              </p>
            </div>
          </section>

          <section className="card">
            <div className="card__header">
              <div className="card__title-group">
                <h2 className="card__title">\u6700\u65b0\u56de\u590d</h2>
                <p className="card__subtitle">\u770b\u770b\u5de6\u4fa7\u72b6\u6001, \u9000\u56de\u6216\u7ee7\u7eed\u4ea4\u4e92\u3002</p>
              </div>
              <div className="card__actions">
                <button
                  type="button"
                  className={`ghost-btn ghost-btn--accent ${copyState === 'copied' ? 'is-success' : ''} ${copyState === 'failed' ? 'is-failed' : ''}`}
                  onClick={handleCopyReply}
                  disabled={!canCopy}
                >
                  {copyLabel}
                </button>
                <button
                  type="button"
                  className="ghost-btn"
                  onClick={handleClearReply}
                  disabled={!canCopy}
                >
                  \u6e05\u7a7a
                </button>
              </div>
            </div>
            <div className="reply-box" role="status" aria-live="polite">
              {lastReplyText ? (
                <p className="reply-box__content">{lastReplyText}</p>
              ) : (
                <p className="reply-box__placeholder">\u7b49\u5f85\u540e\u7aef\u8fd4\u56de\u7b2c\u4e00\u6761\u5185\u5bb9\u3002</p>
              )}
            </div>
          </section>

          <section className="card card--logs card--wide">
            <div className="card__header">
              <div className="card__title-group">
                <h2 className="card__title">\u8c03\u7528\u65e5\u5fd7</h2>
                <p className="card__subtitle">\u4f18\u5148\u67e5\u770b\u6700\u8fd1\u5de6\u8fb9\u4e09\u6761\u8bb0\u5f55\u3002</p>
              </div>
              <button
                type="button"
                className="ghost-btn"
                onClick={handleClearLogs}
                disabled={logs.length === 0}
              >
                \u6e05\u7a7a
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
                <li className="log-list__placeholder">\u6682\u65e0\u65e5\u5fd7, \u7b49\u5f85\u4ea4\u4e92\u3002</li>
              )}
            </ul>
          </section>
        </main>
      </div>

      {(errorMsg || copyState === 'copied' || copyState === 'failed') && (
        <div className="toast-stack">
          {errorMsg && (
            <div className="toast toast--error" role="alert">
              {errorMsg}
            </div>
          )}
          {copyState === 'copied' && !errorMsg && (
            <div className="toast toast--success" role="status">
              \u5df2\u590d\u5236\u5230\u526a\u5200\u677f
            </div>
          )}
          {copyState === 'failed' && !errorMsg && (
            <div className="toast toast--warn" role="alert">
              \u590d\u5236\u5931\u8d25\uff0c\u53ef\u6309 \u201cCtrl+C\u201d \u624b\u52a8\u590d\u5236
            </div>
          )}
        </div>
      )}
    </div>
  )
}
