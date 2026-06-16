from __future__ import annotations

import base64
import io
import os
import threading
import time
from pathlib import Path
from typing import Optional

from fastapi import FastAPI
from pydantic import BaseModel

app = FastAPI(title="DoReMii FLUX Cover Backend")

MODEL_ID = os.environ.get("DOREMII_FLUX_MODEL", "black-forest-labs/FLUX.1-schnell")
DEVICE = os.environ.get("DOREMII_FLUX_DEVICE", "cuda")
DTYPE = os.environ.get("DOREMII_FLUX_DTYPE", "bfloat16")

_pipe = None
_pipe_error: Optional[str] = None
_last_loaded_at: Optional[float] = None
_lock = threading.Lock()


class GenerateRequest(BaseModel):
    prompt: str
    negative_prompt: str = ""
    width: int = 768
    height: int = 768
    steps: int = 4
    guidance_scale: float = 0.0
    seed: Optional[int] = None
    output_path: Optional[str] = None


def _load_pipe():
    global _pipe, _pipe_error, _last_loaded_at
    if _pipe is not None:
        return _pipe
    with _lock:
        if _pipe is not None:
            return _pipe
        try:
            import torch
            from diffusers import FluxPipeline

            dtype = torch.bfloat16 if DTYPE == "bfloat16" else torch.float16
            pipe = FluxPipeline.from_pretrained(MODEL_ID, torch_dtype=dtype)
            pipe.enable_model_cpu_offload()
            try:
                pipe.enable_attention_slicing()
            except Exception:
                pass
            _pipe = pipe
            _pipe_error = None
            _last_loaded_at = time.time()
            return _pipe
        except Exception as exc:  # FastAPI should stay alive and report why.
            _pipe_error = str(exc)
            raise


@app.get("/health")
def health():
    return {
        "ok": True,
        "model": MODEL_ID,
        "loaded": _pipe is not None,
        "last_loaded_at": _last_loaded_at,
        "last_error": _pipe_error,
    }


@app.post("/unload")
def unload():
    global _pipe
    with _lock:
        _pipe = None
        try:
            import torch

            if torch.cuda.is_available():
                torch.cuda.empty_cache()
        except Exception:
            pass
    return {"ok": True}


@app.post("/generate")
def generate(request: GenerateRequest):
    pipe = _load_pipe()
    kwargs = {
        "prompt": request.prompt,
        "width": request.width,
        "height": request.height,
        "num_inference_steps": request.steps,
        "guidance_scale": request.guidance_scale,
        "max_sequence_length": 256,
    }
    if request.seed is not None:
        import torch

        kwargs["generator"] = torch.Generator("cpu").manual_seed(int(request.seed))
    image = pipe(**kwargs).images[0]
    if request.output_path:
        out = Path(request.output_path)
        out.parent.mkdir(parents=True, exist_ok=True)
        image.save(out)
        return {"ok": True, "path": str(out)}
    buffer = io.BytesIO()
    image.save(buffer, format="PNG")
    return {"ok": True, "image_base64": base64.b64encode(buffer.getvalue()).decode("ascii")}
