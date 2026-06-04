"""Clipora AI backend (Hugging Face Space, free CPU).

POST /tts   {text, lang, gender, rate} -> audio/mpeg (Microsoft neural voices via edge-tts)
            falls back to Meta MMS-TTS running on this CPU -> audio/wav
GET  /      health + supported languages
"""
import asyncio
import hashlib
import io
import time
from collections import OrderedDict, defaultdict, deque

import edge_tts
from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response
from pydantic import BaseModel, Field

VOICES = {
    "bn": ("bn-BD-NabanitaNeural", "bn-BD-PradeepNeural"),
    "en": ("en-US-JennyNeural", "en-US-GuyNeural"),
    "hi": ("hi-IN-SwaraNeural", "hi-IN-MadhurNeural"),
    "ar": ("ar-SA-ZariyahNeural", "ar-SA-HamedNeural"),
    "ur": ("ur-PK-UzmaNeural", "ur-PK-AsadNeural"),
    "es": ("es-ES-ElviraNeural", "es-ES-AlvaroNeural"),
    "fr": ("fr-FR-DeniseNeural", "fr-FR-HenriNeural"),
    "de": ("de-DE-KatjaNeural", "de-DE-ConradNeural"),
    "pt": ("pt-BR-FranciscaNeural", "pt-BR-AntonioNeural"),
    "id": ("id-ID-GadisNeural", "id-ID-ArdiNeural"),
    "tr": ("tr-TR-EmelNeural", "tr-TR-AhmetNeural"),
    "ru": ("ru-RU-SvetlanaNeural", "ru-RU-DmitryNeural"),
    "ja": ("ja-JP-NanamiNeural", "ja-JP-KeitaNeural"),
    "ko": ("ko-KR-SunHiNeural", "ko-KR-InJoonNeural"),
    "zh": ("zh-CN-XiaoxiaoNeural", "zh-CN-YunxiNeural"),
}
MMS = {"bn": "facebook/mms-tts-ben", "en": "facebook/mms-tts-eng", "hi": "facebook/mms-tts-hin", "ar": "facebook/mms-tts-ara", "ur": "facebook/mms-tts-urd-script_arabic", "es": "facebook/mms-tts-spa"}

app = FastAPI(title="Clipora AI")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["GET", "POST"], allow_headers=["*"])


class TTSReq(BaseModel):
    text: str = Field(min_length=1, max_length=2000)
    lang: str = "en"
    gender: str = "female"
    rate: int = Field(0, ge=-50, le=50)


# --- simple per-IP rate limit + small result cache (keeps the free Space healthy) ---
LIMIT, WINDOW = 120, 600
hits: dict[str, deque] = defaultdict(deque)
cache: OrderedDict[str, tuple[bytes, str]] = OrderedDict()


def check_rate(ip: str):
    q = hits[ip]
    now = time.time()
    while q and now - q[0] > WINDOW:
        q.popleft()
    if len(q) >= LIMIT:
        raise HTTPException(429, "Too many requests, try again in a few minutes")
    q.append(now)


async def edge(text: str, voice: str, rate: int) -> bytes:
    com = edge_tts.Communicate(text, voice, rate=f"{rate:+d}%")
    buf = bytearray()
    async for chunk in com.stream():
        if chunk["type"] == "audio":
            buf += chunk["data"]
    if not buf:
        raise RuntimeError("edge-tts returned no audio")
    return bytes(buf)


_mms = {}


def mms(text: str, lang: str) -> bytes:
    import numpy as np
    import scipy.io.wavfile
    import torch
    from transformers import AutoTokenizer, VitsModel

    name = MMS.get(lang, MMS["en"])
    if name not in _mms:
        _mms[name] = (VitsModel.from_pretrained(name).eval(), AutoTokenizer.from_pretrained(name))
    model, tok = _mms[name]
    with torch.no_grad():
        wav = model(**tok(text, return_tensors="pt")).waveform[0].numpy()
    out = io.BytesIO()
    scipy.io.wavfile.write(out, model.config.sampling_rate, (np.clip(wav, -1, 1) * 32767).astype(np.int16))
    return out.getvalue()


@app.get("/")
def health():
    return {"ok": True, "service": "clipora-ai", "tts_languages": sorted(VOICES)}


@app.post("/tts")
async def tts(req: TTSReq, request: Request):
    ip = request.headers.get("x-forwarded-for", request.client.host if request.client else "?").split(",")[0].strip()
    check_rate(ip)
    lang = req.lang if req.lang in VOICES else "en"
    voice = VOICES[lang][1 if req.gender == "male" else 0]
    key = hashlib.sha1(f"{voice}|{req.rate}|{req.text}".encode()).hexdigest()
    if key in cache:
        cache.move_to_end(key)
        data, mime = cache[key]
    else:
        try:
            data, mime = await asyncio.wait_for(edge(req.text, voice, req.rate), 45), "audio/mpeg"
        except Exception as e:  # Microsoft service unreachable → local model
            print("edge-tts failed, using MMS:", repr(e), flush=True)
            data, mime = await asyncio.to_thread(mms, req.text, lang), "audio/wav"
        cache[key] = (data, mime)
        while len(cache) > 300:
            cache.popitem(last=False)
    return Response(data, media_type=mime, headers={"Cache-Control": "public, max-age=86400", "X-Engine": "edge" if mime == "audio/mpeg" else "mms"})
