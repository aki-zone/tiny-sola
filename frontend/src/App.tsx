import React, { useEffect, useRef, useState } from 'react'
import './App.css'

const API_BASE = import.meta.env.VITE_API_BASE || 'http://localhost:8000'

type Status = 'idle' | 'recording' | 'uploading' | 'reply_ready' | 'error'

type StatusVisual = {
  label: string
  tone: 'neutral' | 'active' | 'loading' | 'success' | 'error'
}

const STATUS_MAP: Record<Status, StatusVisual> = {
  idle: { label: '\u51c6\u5907\u5c31\u7eea', tone: 'neutral' },
  recording: { label: '\u5f55\u97f3\u4e2d...', tone: 'active' },
  uploading: { label: '\u89e3\u6790\u4e2d...', tone: 'loading' },
  reply_ready: { label: '\u56de\u590d\u5df2\u66f4\u65b0', tone: 'success' },
  error: { label: '\u5df2\u505c\u6b62, \u53d1\u751f\u9519\u8bef', tone: 'error' },
}

const WORKFLOW_SUMMARY = '\u5f55\u97f3 -> \u8bed\u97f3\u8bc6\u522b -> \u5927\u6a21\u578b\u56de\u590d -> \u8bed\u97f3\u5408\u6210 -> \u64ad\u653e'

export default function App() {
  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const audioChunksRef = useRef<Blob[]>([])
  const [isRecording, setIsRecording] = useState(false)
  const [status, setStatus] = useState<Status>('idle')
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const [logs, setLogs] = useState<string[]>([])
  const [lastReplyText, setLastReplyText] = useState('')

  useEffect(() => {
    return () => {
      if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
        mediaRecorderRef.current.stop()
      }
    }
  }, [])

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
      setLogs((prev) => ['\u5f00\u59cb\u5f55\u97f3', ...prev])
    } catch (error) {
      const message = error instanceof Error ? error.message : '\u65e0\u6cd5\u8bbf\u95ee\u9ea6\u514b\u98ce'
      setLogs((prev) => [`\u9ea6\u514b\u98ce\u8bbf\u95ee\u5931\u8d25: ${message}`, ...prev])
      setErrorMsg('\u8bf7\u68c0\u67e5\u6d4f\u89c8\u5668\u9ea6\u514b\u98ce\u6743\u9650\u8bbe\u7f6e\u540e\u91cd\u8bd5.')
      setStatus('error')
    }
  }

  function stopRecording() {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop()
      setLogs((prev) => ['\u5df2\u505c\u6b62\u5f55\u97f3, \u51c6\u5907\u4e0a\u4f20...', ...prev])
    }
  }

  async function sendToTalk(blob: Blob) {
    setLogs((prev) => ['\u4e0a\u4f20\u97f3\u9891\u4e2d...', ...prev])
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

      setLogs((prev) => [
        `LLM: ${replyText || '(\u7a7a)'}`,
        `ASR: ${transcription || '(\u7a7a)'}`,
        ...prev,
      ])
      setLastReplyText(replyText)

      if (audioBase64) {
        const audio = new Audio(`data:audio/wav;base64,${audioBase64}`)
        audio.play().catch(() => {
          setLogs((prev) => ['\u97f3\u9891\u64ad\u653e\u5931\u8d25(\u53ef\u80fd\u88ab\u6d4f\u89c8\u5668\u62e6\u622a)', ...prev])
        })
      }

      setStatus('reply_ready')
    } catch (error) {
      const message = error instanceof Error ? error.message : '\u672a\u77e5\u9519\u8bef'
      setStatus('error')
      setErrorMsg(`\u8c03\u7528\u63a5\u53e3\u5931\u8d25: ${message}`)
      setLogs((prev) => ['\u8c03\u7528 /talk \u5931\u8d25', ...prev])
    }
  }

  const statusInfo = STATUS_MAP[status]

  return (
    <div className="app">
      <div className="app__shell">
        <header className="app__header">
          <span className="app__badge">MVP</span>
          <h1 className="app__title">tiny-sola \u5bf9\u8bdd\u9762\u677f</h1>
          <p className="app__subtitle">{WORKFLOW_SUMMARY}</p>
        </header>

        <main className="app__main">
          <section className="card">
            <div className="card__header">
              <h2 className="card__title">\u5b9e\u65f6\u5f55\u97f3</h2>
              <span className={`status-chip status-chip--${statusInfo.tone}`}>
                {statusInfo.label}
              </span>
            </div>
            <div className="recorder">
              <button
                className={`record-btn ${isRecording ? 'record-btn--stop' : ''}`}
                onClick={isRecording ? stopRecording : startRecording}
                aria-pressed={isRecording}
              >
                <span className="record-btn__icon" aria-hidden="true" />
                {isRecording ? '\u505c\u6b62\u5f55\u97f3' : '\u5f00\u59cb\u5f55\u97f3'}
              </button>
              <p className="recorder__hint">
                {isRecording
                  ? '\u5f55\u97f3\u8fdb\u884c\u4e2d, \u70b9\u51fb\u6309\u94ae\u7ed3\u675f\u5e76\u53d1\u9001\u5230\u540e\u7aef.'
                  : '\u70b9\u51fb\u6309\u94ae\u6388\u6743\u9ea6\u514b\u98ce\u5e76\u5f00\u59cb\u5f55\u97f3.'}
              </p>
            </div>
          </section>

          <section className="card">
            <div className="card__header">
              <h2 className="card__title">\u6700\u65b0\u56de\u590d</h2>
              {lastReplyText && (
                <button className="ghost-btn" onClick={() => setLastReplyText('')}>
                  \u6e05\u7a7a
                </button>
              )}
            </div>
            <div className="reply-box">
              {lastReplyText ? (
                <p className="reply-box__content">{lastReplyText}</p>
              ) : (
                <p className="reply-box__placeholder">\u7b49\u5f85\u540e\u7aef\u8fd4\u56de\u7b2c\u4e00\u6761\u5185\u5bb9.</p>
              )}
            </div>
          </section>

          <section className="card card--logs">
            <div className="card__header">
              <h2 className="card__title">\u8c03\u7528\u65e5\u5fd7</h2>
              <button
                className="ghost-btn"
                onClick={() => setLogs([])}
                disabled={logs.length === 0}
              >
                \u6e05\u7a7a
              </button>
            </div>
            <ul className="log-list">
              {logs.length ? (
                logs.map((entry, index) => <li key={index}>{entry}</li>)
              ) : (
                <li className="log-list__placeholder">\u6682\u65e0\u65e5\u5fd7, \u7b49\u5f85\u4ea4\u4e92.</li>
              )}
            </ul>
          </section>
        </main>
      </div>

      {errorMsg && (
        <div className="toast" role="alert">
          {errorMsg}
        </div>
      )}
    </div>
  )
}
