import React, { useEffect, useRef, useState } from 'react'

const API_BASE = import.meta.env.VITE_API_BASE || 'http://localhost:8000'

export default function App() {
  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const audioChunksRef = useRef<Blob[]>([])
  const [isRecording, setIsRecording] = useState(false)
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
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
    const recorder = new MediaRecorder(stream)
    audioChunksRef.current = []

    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) audioChunksRef.current.push(e.data)
    }

    recorder.onstop = async () => {
      const blob = new Blob(audioChunksRef.current, { type: 'audio/webm' })
      await sendToTalk(blob)
      stream.getTracks().forEach(t => t.stop())
    }

    recorder.start()
    mediaRecorderRef.current = recorder
    setIsRecording(true)
  }

  function stopRecording() {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop()
    }
    setIsRecording(false)
  }

  async function sendToTalk(blob: Blob) {
    setLogs(prev => ["上传音频…", ...prev])
    const form = new FormData()
    // backend expects wav; browser gives webm. We'll still send webm, backend uses faster-whisper that expects wav.
    // For MVP, we accept container mismatch on backend and rely on ffmpeg being available in system to convert later.
    form.append('file', blob, 'audio.webm')
    const res = await fetch(`${API_BASE}/talk`, {
      method: 'POST',
      body: form
    })
    if (!res.ok) {
      setLogs(prev => ["调用 /talk 失败", ...prev])
      return
    }
    const data = await res.json()
    setLogs(prev => [
      `ASR: ${data.transcription || ''}`,
      `LLM: ${data.reply_text || ''}`,
      ...prev,
    ])
    setLastReplyText(data.reply_text || '')
    const b64 = data.reply_audio_base64
    if (b64) {
      const audio = new Audio(`data:audio/wav;base64,${b64}`)
      audio.play()
    }
  }

  return (
    <div style={{ maxWidth: 720, margin: '0 auto', fontFamily: 'system-ui, sans-serif', padding: 16 }}>
      <h2>tiny-sola</h2>
      <p>最小化语音对话 MVP：录音 → ASR → LLM → TTS → 播放</p>
      <div style={{ display: 'flex', gap: 12 }}>
        {!isRecording ? (
          <button onClick={startRecording}>开始录音</button>
        ) : (
          <button onClick={stopRecording}>停止并发送</button>
        )}
      </div>
      <div style={{ marginTop: 16 }}>
        <div><b>最后一次回复文本：</b></div>
        <div>{lastReplyText}</div>
      </div>
      <div style={{ marginTop: 16 }}>
        <div><b>日志</b></div>
        <ul>
          {logs.map((l, i) => (<li key={i}>{l}</li>))}
        </ul>
      </div>
    </div>
  )
} 