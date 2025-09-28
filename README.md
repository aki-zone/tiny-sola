# tiny-sola · 角色扮演语音网页

这是一个将语音管线（录音 → ASR → LLM → TTS）与角色扮演体验结合的示例项目。用户可以搜索感兴趣的角色（如哈利·波特、苏格拉底、花木兰），与其进行实时语音聊天，并触发多种“角色技能”来获取额外的文本指引。

- 后端：FastAPI，整合 faster-whisper、Ollama、Piper，新增角色/技能配置与多能力接口。
- 前端：React + Vite，提供角色搜索、语音对话、技能触发、日志与健康检查等界面。

> 更详细的需求分析与功能规划，请参阅 `docs/role-play-spec.md`。

## 目录结构

```text
backend/   FastAPI 服务，包含角色与技能配置
frontend/  React Web UI（Vite）
docs/      方案与需求说明文档
```

## 运行前准备

- Python 3.10+
- Node.js 18+
- 本地环境需具备：
  - **Ollama**（默认模型 `llama3:8b`，可改为 `qwen2:7b` 等）并确保模型已拉取
  - **Piper** 可执行文件与语音模型
  - **ffmpeg** 用于转码前端上传的 WebM/OGG 音频

可通过环境变量覆盖默认配置：

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `FW_MODEL` | `base` | faster-whisper 模型名 |
| `FW_DEVICE` | `cpu` | faster-whisper 运行设备 |
| `FW_COMPUTE` | `int8` | faster-whisper 计算精度 |
| `OLLAMA_HOST` | `http://localhost:11434` | Ollama 服务地址 |
| `OLLAMA_MODEL` | `llama3:8b` | LLM 模型名称 |
| `PIPER_BIN` | `piper` | Piper 可执行文件路径 |
| `PIPER_MODEL` | `./voices/en_US-ryan-high.onnx` | Piper 语音模型 |

## 启动方式

### 后端（FastAPI）
```powershell
cd backend
python -m venv .venv
. .venv/Scripts/Activate.ps1
pip install -r requirements.txt
uvicorn app.main:app --host 0.0.0.0 --port 8000
```

### 前端（Vite）
```powershell
cd frontend
npm install
npm run dev
```

访问 `http://localhost:5173` 即可体验。

## 主要特性

- 🔍 **角色搜索与详情**：关键字筛选预设角色，查看背景、风格与建议提问。
- 🎙️ **多轮语音对话**：录音、ASR、LLM 回复与 TTS 播放串联；`/talk` 接口会带上角色设定与最近 8 轮上下文。
- 🧰 **角色技能（>=3 项）**：
  - 角色速写：用 4-5 句第一人称总结身份与心态；
  - 代表性语句：生成金句并解释启发；
  - 导师建议：结合用户输入输出三步行动清单；
  - 反思提问：产出开放式问题帮助自省。
- 📒 **技能输出面板**：技能结果按时间倒序归档，便于与语音对话对照。
- 🩺 **一键健康检查**：快速确认 ffmpeg、Piper、Ollama 是否就绪。
- 🧾 **调用日志**：记录每一次录音、技能调用与系统提示，便于调试排障。

## 自定义角色/技能

角色与技能的配置集中在 `backend/app/roles.py`：
- 每个角色包含背景、表达风格、知识关注点等信息；
- 技能声明了名称、描述、提示词模板及是否需要用户输入；
- 前端会自动渲染对应的技能表单与按钮。

调整配置后无需改动 API，只要重启后端即可生效。

## 测试与构建

- 前端：`npm run build`
- 后端：`python -m compileall app`（快速语法检查）

## 许可

本项目主要用于演示语音管线 + 角色扮演的整合方式，可在学习与原型设计场景下自由使用。
