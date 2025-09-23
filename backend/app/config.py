import os

class Settings:
    FW_MODEL = os.getenv("FW_MODEL", "base")
    FW_DEVICE = os.getenv("FW_DEVICE", "cpu")
    FW_COMPUTE_TYPE = os.getenv("FW_COMPUTE", "int8")

    OLLAMA_HOST = os.getenv("OLLAMA_HOST", "http://localhost:11434")
    OLLAMA_MODEL = os.getenv("OLLAMA_MODEL", "llama3:8b")

    # Piper binary and model path (onnx or onnx.gz + json)
    PIPER_BIN = os.getenv("PIPER_BIN", "piper")
    PIPER_MODEL = os.getenv("PIPER_MODEL", "./voices/en_US-ryan-high.onnx")

settings = Settings() 