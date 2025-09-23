# tiny-sola

最小可运行的本地语音对话 MVP：录音 → ASR(faster-whisper) → LLM(Ollama) → TTS(piper) → 播放。

## 目录结构

- `backend/`: FastAPI 服务，提供 `/transcribe` `/chat` `/speak` `/talk`
- `frontend/`: React + Vite WebUI

## 先决条件

- Python 3.10+
- Node.js 18+
- 已安装并可用：
  - Ollama (默认 `http://localhost:11434`，模型默认 `llama3:8b`) 运行：`ollama run llama3:8b`
  - piper 可执行文件与模型（设置环境变量 `PIPER_BIN` 与 `PIPER_MODEL`）
  - ffmpeg（用于将浏览器录制的 WebM/OGG 转换为 WAV）

可选环境变量：
- `FW_MODEL`(默认 `base`)、`FW_DEVICE`(默认 `cpu`)、`FW_COMPUTE`(默认 `int8`)
- `OLLAMA_HOST`、`OLLAMA_MODEL`
- `PIPER_BIN`、`PIPER_MODEL`

## 启动

Windows PowerShell 示例：

```powershell
# 后端
cd backend
python -m venv .venv
. .venv/Scripts/Activate.ps1
pip install -r requirements.txt
uvicorn app.main:app --host 0.0.0.0 --port 8000
```

另开一个终端：

```powershell
# 前端
cd frontend
npm i
npm run dev
```

访问：`http://localhost:5173`

## 一键脚本（可选）

见根目录 `start.ps1`，会并行启动后端与前端（需已安装依赖）。

## /talk 流程

1. 前端录音（MediaRecorder WebM）上传到 `/talk`
2. 后端用 ffmpeg 转成 `16kHz mono WAV`
3. faster-whisper 识别文本
4. 调用 Ollama 生成回复
5. Piper 合成 WAV 并以 Base64 返回，前端直接播放 