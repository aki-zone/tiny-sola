from fastapi import FastAPI, UploadFile, File
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel
import uvicorn
import tempfile
import base64
import subprocess
import os
import shutil
from typing import Optional
from datetime import datetime

from .config import settings

app = FastAPI(title="tiny-sola API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"]
)

class ChatRequest(BaseModel):
    text: str


def convert_to_wav(input_path: str, output_path: str) -> None:
    # Requires ffmpeg in PATH
    cmd = ["ffmpeg", "-y", "-i", input_path, "-ar", "16000", "-ac", "1", output_path]
    subprocess.run(cmd, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, check=True)


def ensure_wav(temp_path: str, content_type: Optional[str]) -> str:
    if content_type and ("wav" in content_type or content_type == "audio/wave"):
        return temp_path
    out_fd, out_path = tempfile.mkstemp(suffix=".wav")
    os.close(out_fd)
    convert_to_wav(temp_path, out_path)
    try:
        os.remove(temp_path)
    except Exception:
        pass
    return out_path


def run_faster_whisper(wav_path: str) -> str:
    from faster_whisper import WhisperModel
    model = WhisperModel(settings.FW_MODEL, device=settings.FW_DEVICE, compute_type=settings.FW_COMPUTE_TYPE)
    segments, _ = model.transcribe(wav_path, beam_size=1)
    text_parts = [seg.text for seg in segments]
    return " ".join(part.strip() for part in text_parts).strip()


def run_ollama(prompt: str) -> str:
    import requests
    url = f"{settings.OLLAMA_HOST}/api/generate"
    payload = {
        "model": settings.OLLAMA_MODEL,
        "prompt": prompt,
        "stream": False,
    }
    resp = requests.post(url, json=payload, timeout=600)
    resp.raise_for_status()
    data = resp.json()
    return data.get("response", "")


def run_piper_tts(text: str, out_wav_path: str) -> None:
    cmd = [settings.PIPER_BIN, "-m", settings.PIPER_MODEL, "-f", out_wav_path]
    subprocess.run(cmd, input=text.encode("utf-8"), check=True)


@app.post("/transcribe")
async def transcribe(file: UploadFile = File(...)):
    with tempfile.NamedTemporaryFile(delete=False) as tmp:
        in_path = tmp.name
        content = await file.read()
        tmp.write(content)
    try:
        wav_path = ensure_wav(in_path, file.content_type)
        text = run_faster_whisper(wav_path)
        return {"text": text}
    finally:
        for p in [in_path, locals().get("wav_path")]:
            try:
                if p and os.path.exists(p):
                    os.remove(p)
            except Exception:
                pass


@app.post("/chat")
async def chat(req: ChatRequest):
    reply = run_ollama(req.text)
    return {"text": reply}


class SpeakRequest(BaseModel):
    text: str


@app.post("/speak")
async def speak(req: SpeakRequest):
    with tempfile.NamedTemporaryFile(delete=False, suffix=".wav") as tmp:
        out_path = tmp.name
    try:
        run_piper_tts(req.text, out_path)
        with open(out_path, "rb") as f:
            wav_bytes = f.read()
        b64 = base64.b64encode(wav_bytes).decode("ascii")
        return {"audio_base64": b64}
    finally:
        try:
            os.remove(out_path)
        except Exception:
            pass



@app.get("/health")
async def health():
    ffmpeg_path = shutil.which("ffmpeg")
    if os.path.isabs(settings.PIPER_BIN):
        piper_path = settings.PIPER_BIN if os.path.exists(settings.PIPER_BIN) else None
    else:
        piper_path = shutil.which(settings.PIPER_BIN)
    piper_model_available = os.path.exists(settings.PIPER_MODEL)

    ollama_available = False
    ollama_error: Optional[str] = None
    try:
        import requests

        resp = requests.get(f"{settings.OLLAMA_HOST}/api/tags", timeout=3)
        resp.raise_for_status()
        ollama_available = True
    except Exception as exc:  # noqa: BLE001 - surface error message to caller
        ollama_error = str(exc)

    has_all = all([
        bool(ffmpeg_path),
        bool(piper_path),
        piper_model_available,
        ollama_available,
    ])

    status_value = "ok" if has_all else "degraded"

    return {
        "status": status_value,
        "timestamp": datetime.utcnow().isoformat(timespec="seconds") + "Z",
        "details": {
            "ffmpeg": {"available": bool(ffmpeg_path), "path": ffmpeg_path},
            "piper": {
                "binary_available": bool(piper_path),
                "binary_path": piper_path,
                "model_available": piper_model_available,
                "model_path": settings.PIPER_MODEL,
            },
            "ollama": {
                "available": ollama_available,
                "host": settings.OLLAMA_HOST,
                "model": settings.OLLAMA_MODEL,
                "error": ollama_error,
            },
        },
    }

@app.post("/talk")
async def talk(file: UploadFile = File(...)):
    with tempfile.NamedTemporaryFile(delete=False) as tmp:
        in_path = tmp.name
        content = await file.read()
        tmp.write(content)
    try:
        wav_in_path = ensure_wav(in_path, file.content_type)
        user_text = run_faster_whisper(wav_in_path)
    finally:
        for p in [in_path, locals().get("wav_in_path")]:
            try:
                if p and os.path.exists(p):
                    os.remove(p)
            except Exception:
                pass

    reply_text = run_ollama(user_text)

    with tempfile.NamedTemporaryFile(delete=False, suffix=".wav") as tmp_out:
        wav_out_path = tmp_out.name
    try:
        run_piper_tts(reply_text, wav_out_path)
        with open(wav_out_path, "rb") as f:
            wav_bytes = f.read()
        b64 = base64.b64encode(wav_bytes).decode("ascii")
    finally:
        try:
            os.remove(wav_out_path)
        except Exception:
            pass

    return JSONResponse({
        "transcription": user_text,
        "reply_text": reply_text,
        "reply_audio_base64": b64,
    })


if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=8000) 
