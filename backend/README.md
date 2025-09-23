# tiny-sola backend

## 运行

```powershell
python -m venv .venv
. .venv/Scripts/Activate.ps1
pip install -r requirements.txt
uvicorn app.main:app --host 0.0.0.0 --port 8000
```

## 环境变量

- `FW_MODEL` 默认 `base`（如需中文可改 `medium`/`large-v3` 等，资源更高）
- `FW_DEVICE` `cpu`/`cuda`
- `FW_COMPUTE` `int8`/`float16`/`float32`
- `OLLAMA_HOST` 默认 `http://localhost:11434`
- `OLLAMA_MODEL` 默认 `llama3:8b`
- `PIPER_BIN` `piper` 可执行路径
- `PIPER_MODEL` Piper 模型 `.onnx` 路径

依赖外部：`ffmpeg` 应位于 PATH 