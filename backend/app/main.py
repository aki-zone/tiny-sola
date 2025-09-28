"""FastAPI backend powering the role-playing voice experience."""

from __future__ import annotations

import base64
import json
import os
import shutil
import subprocess
import tempfile
from datetime import datetime
from typing import List, Literal, Optional

import requests
from fastapi import File, Form, HTTPException, UploadFile, FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field, ValidationError

from .config import settings
from .roles import (
    DEFAULT_ROLE_ID,
    RoleDefinition,
    SkillDefinition,
    get_role,
    get_skill,
    list_roles,
    public_role_info,
)

app = FastAPI(title="tiny-sola API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


class ChatRequest(BaseModel):
    text: str


class ConversationMessage(BaseModel):
    role: Literal["user", "assistant"]
    content: str


class SpeakRequest(BaseModel):
    text: str


class SkillInvokeRequest(BaseModel):
    input_text: Optional[str] = None
    speak: bool = False
    history: List[ConversationMessage] = Field(default_factory=list)


# ---------------------------------------------------------------------------
# Audio utilities
# ---------------------------------------------------------------------------

def convert_to_wav(input_path: str, output_path: str) -> None:
    """Convert arbitrary audio input to mono 16kHz wav using ffmpeg."""

    cmd = ["ffmpeg", "-y", "-i", input_path, "-ar", "16000", "-ac", "1", output_path]
    subprocess.run(cmd, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, check=True)


def ensure_wav(temp_path: str, content_type: Optional[str]) -> str:
    """Ensure the uploaded file is wav; convert when necessary."""

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
    url = f"{settings.OLLAMA_HOST}/api/generate"
    payload = {
        "model": settings.OLLAMA_MODEL,
        "prompt": prompt,
        "stream": False,
    }
    resp = requests.post(url, json=payload, timeout=600)
    resp.raise_for_status()
    data = resp.json()
    return data.get("response", "").strip()


def run_piper_tts(text: str, out_wav_path: str) -> None:
    cmd = [settings.PIPER_BIN, "-m", settings.PIPER_MODEL, "-f", out_wav_path]
    subprocess.run(cmd, input=text.encode("utf-8"), check=True)


def text_to_speech_base64(text: str) -> str:
    with tempfile.NamedTemporaryFile(delete=False, suffix=".wav") as tmp:
        out_path = tmp.name
    try:
        run_piper_tts(text, out_path)
        with open(out_path, "rb") as f:
            wav_bytes = f.read()
        return base64.b64encode(wav_bytes).decode("ascii")
    finally:
        try:
            os.remove(out_path)
        except Exception:
            pass


# ---------------------------------------------------------------------------
# Prompt building helpers
# ---------------------------------------------------------------------------

def parse_history(history_payload: Optional[str]) -> List[ConversationMessage]:
    if not history_payload:
        return []
    try:
        raw = json.loads(history_payload)
    except json.JSONDecodeError as exc:
        raise HTTPException(status_code=400, detail="history 参数需要合法的 JSON") from exc
    if not isinstance(raw, list):
        raise HTTPException(status_code=400, detail="history 参数必须是数组")

    messages: List[ConversationMessage] = []
    # Keep the last 8 messages to control prompt length.
    for item in raw[-8:]:
        try:
            msg = ConversationMessage.model_validate(item)
        except ValidationError as exc:
            raise HTTPException(status_code=400, detail="history 数据格式不正确") from exc
        if msg.content.strip():
            messages.append(msg)
    return messages


def format_history(history: List[ConversationMessage], role_name: str) -> str:
    lines = []
    for msg in history:
        speaker = "用户" if msg.role == "user" else role_name
        lines.append(f"{speaker}: {msg.content.strip()}")
    return "\n".join(lines)


def ensure_role(role_id: str) -> RoleDefinition:
    role = get_role(role_id)
    if not role:
        raise HTTPException(status_code=404, detail="未找到对应的角色")
    return role


def ensure_skill(skill_id: str) -> SkillDefinition:
    skill = get_skill(skill_id)
    if not skill:
        raise HTTPException(status_code=404, detail="未找到对应的技能")
    return skill


def build_conversation_prompt(role: RoleDefinition, user_text: str, history: List[ConversationMessage]) -> str:
    knowledge_focus = role.get("knowledge_focus", [])
    focus_text = "、".join(knowledge_focus)
    sections = [
        f"角色设定：{role['name']}（{role.get('alias') or role['name']}），{role.get('tagline', '')}",
        f"背景补充：{role.get('background', '')}",
        f"表达风格：{role.get('style', '')}",
    ]
    if focus_text:
        sections.append(f"擅长分享的主题：{focus_text}")
    sections.append(
        "对话要求：\n"
        "1. 使用中文第一人称叙述，保持角色独特的语气。\n"
        "2. 回答长度控制在 2-4 句，可适当使用换行或短列表。\n"
        "3. 若用户提及过往事件，请结合上下文回应；避免跳出角色设定。"
    )
    if history:
        sections.append("最近的对话记录：\n" + format_history(history, role.get('name', '助手')))
    sections.append(f"用户最新的语音转写内容：{user_text.strip()}")
    sections.append("请给出你的回答，只返回角色的话语。")
    return "\n\n".join(filter(None, sections))


def build_skill_prompt(
    role: RoleDefinition,
    skill: SkillDefinition,
    user_input: Optional[str],
    history: List[ConversationMessage],
) -> str:
    sections = [
        f"角色设定：{role['name']}（{role.get('alias') or role['name']}），{role.get('tagline', '')}",
        f"背景补充：{role.get('background', '')}",
        f"表达风格：{role.get('style', '')}",
        f"技能目标：{skill['description']}",
        f"执行说明：{skill['prompt_instructions']}",
    ]
    if skill.get("include_history") and history:
        sections.append("相关对话回顾：\n" + format_history(history, role.get('name', '助手')))
    if user_input:
        sections.append(f"用户额外说明：{user_input.strip()}")
    sections.append("请输出符合技能目标的内容，保持角色语气，并使用地道中文。")
    return "\n\n".join(filter(None, sections))


def generate_role_reply(role_id: str, user_text: str, history: List[ConversationMessage]) -> str:
    role = ensure_role(role_id)
    prompt = build_conversation_prompt(role, user_text, history)
    return run_ollama(prompt)


def generate_skill_reply(
    role_id: str,
    skill_id: str,
    user_input: Optional[str],
    history: List[ConversationMessage],
) -> str:
    role = ensure_role(role_id)
    skill = ensure_skill(skill_id)
    if skill.get("requires_user_input") and not (user_input and user_input.strip()):
        raise HTTPException(status_code=400, detail="该技能需要额外输入内容")
    prompt = build_skill_prompt(role, skill, user_input, history)
    return run_ollama(prompt)


# ---------------------------------------------------------------------------
# API routes
# ---------------------------------------------------------------------------


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


@app.post("/speak")
async def speak(req: SpeakRequest):
    audio_base64 = text_to_speech_base64(req.text)
    return {"audio_base64": audio_base64}


@app.get("/roles")
async def list_available_roles():
    roles = [public_role_info(role) for role in list_roles()]
    return {"roles": roles, "default_role_id": DEFAULT_ROLE_ID}


@app.get("/roles/{role_id}")
async def get_role_details(role_id: str):
    role = ensure_role(role_id)
    return public_role_info(role)


@app.post("/roles/{role_id}/skills/{skill_id}")
async def invoke_skill(role_id: str, skill_id: str, req: SkillInvokeRequest):
    reply_text = generate_skill_reply(role_id, skill_id, req.input_text, req.history)
    response = {
        "role_id": role_id,
        "skill_id": skill_id,
        "text": reply_text,
    }
    if req.speak:
        response["reply_audio_base64"] = text_to_speech_base64(reply_text)
    return response


@app.post("/talk")
async def talk(
    file: UploadFile = File(...),
    role_id: str = Form(DEFAULT_ROLE_ID),
    history: Optional[str] = Form(None),
):
    history_messages = parse_history(history)

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

    if not user_text:
        raise HTTPException(status_code=400, detail="未识别到有效的语音内容")

    reply_text = generate_role_reply(role_id, user_text, history_messages)

    audio_b64 = text_to_speech_base64(reply_text)

    return JSONResponse(
        {
            "role_id": role_id,
            "transcription": user_text,
            "reply_text": reply_text,
            "reply_audio_base64": audio_b64,
        }
    )


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
        resp = requests.get(f"{settings.OLLAMA_HOST}/api/tags", timeout=3)
        resp.raise_for_status()
        ollama_available = True
    except Exception as exc:  # noqa: BLE001
        ollama_error = str(exc)

    has_all = all(
        [
            bool(ffmpeg_path),
            bool(piper_path),
            piper_model_available,
            ollama_available,
        ]
    )

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


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="0.0.0.0", port=8000)
