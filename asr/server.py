"""
Service ASR - Transcription automatique avec NVIDIA Parakeet v3.
Fallback en mode mock si le modèle n'est pas disponible.

Variables d'environnement :
  ASR_MODE : "auto" (défaut), "parakeet" ou "mock"
  ASR_MODEL : nom du modèle HuggingFace (défaut: nvidia/parakeet-tdt-0.6b-v3)
"""

import os
import logging
import tempfile
import random
import time

from fastapi import FastAPI, UploadFile, File
from fastapi.middleware.cors import CORSMiddleware

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("zitata-asr")

ASR_MODE = os.environ.get("ASR_MODE", "auto")
ASR_MODEL = os.environ.get("ASR_MODEL", "Archime/parakeet-tdt-0.6b-v3-fr-tv-media")

asr_model = None

app = FastAPI(title="Zitata ASR Service", version="0.2.0")
app.add_middleware(
    CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"]
)


def detect_device() -> str:
    """Détecte le meilleur device disponible : cuda > mps > cpu."""
    try:
        import torch

        if torch.cuda.is_available():
            name = torch.cuda.get_device_name(0)
            vram = torch.cuda.get_device_properties(0).total_mem / 1e9
            logger.info(f"GPU CUDA détecté : {name} ({vram:.1f} Go VRAM)")
            return "cuda"
        if hasattr(torch.backends, "mps") and torch.backends.mps.is_available():
            logger.info("Apple MPS détecté (Mac M-series)")
            return "mps"
    except ImportError:
        pass
    logger.info("Pas de GPU — mode CPU (lent pour audio > 5 min)")
    return "cpu"


def load_parakeet():
    """Charge le modèle Parakeet v3 via NeMo."""
    global asr_model, ASR_MODE
    try:
        import nemo.collections.asr as nemo_asr

        device = detect_device()
        logger.info(f"Chargement du modèle {ASR_MODEL} sur {device}...")
        asr_model = nemo_asr.models.ASRModel.from_pretrained(model_name=ASR_MODEL)

        if device == "cuda":
            asr_model = asr_model.cuda()
        elif device == "mps":
            import torch
            asr_model = asr_model.to(torch.device("mps"))

        ASR_MODE = "parakeet"
        logger.info(f"Modèle {ASR_MODEL} chargé sur {device} — mode parakeet actif")
    except Exception as e:
        logger.warning(f"Impossible de charger Parakeet: {e}")
        if ASR_MODE == "parakeet":
            raise RuntimeError(f"Mode parakeet requis mais modèle indisponible: {e}")
        ASR_MODE = "mock"
        logger.info("Fallback en mode mock")


@app.on_event("startup")
async def startup():
    if ASR_MODE in ("auto", "parakeet"):
        load_parakeet()
    else:
        logger.info("Mode mock forcé par ASR_MODE=mock")


@app.get("/health")
async def health():
    return {
        "status": "ok",
        "service": "zitata-asr",
        "mode": ASR_MODE,
        "model": ASR_MODEL if ASR_MODE == "parakeet" else None,
    }


@app.post("/transcribe")
async def transcribe(file: UploadFile = File(...)):
    if ASR_MODE == "parakeet" and asr_model is not None:
        return await transcribe_parakeet(file)
    return await transcribe_mock(file)


def convert_to_mono_wav(input_path: str) -> str:
    """Convertit tout format audio en WAV mono 16kHz via ffmpeg."""
    import subprocess

    output_path = input_path.rsplit(".", 1)[0] + "_mono.wav"
    subprocess.run(
        ["ffmpeg", "-y", "-i", input_path, "-ac", "1", "-ar", "16000", output_path],
        capture_output=True,
        check=True,
    )
    return output_path


async def transcribe_parakeet(file: UploadFile):
    """Transcription réelle via Parakeet v3."""
    content = await file.read()

    suffix = os.path.splitext(file.filename or "audio.mp3")[1] or ".mp3"
    with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as tmp:
        tmp.write(content)
        tmp_path = tmp.name

    wav_path = None
    try:
        wav_path = convert_to_mono_wav(tmp_path)
        logger.info(f"Transcription de {file.filename} ({len(content)} octets)...")
        output = asr_model.transcribe([wav_path], timestamps=True)
        result = output[0]

        segments = []

        if hasattr(result, "timestamp") and result.timestamp:
            logger.info(f"Timestamp keys: {list(result.timestamp.keys())}")
            seg_timestamps = result.timestamp.get("segment", [])
            word_timestamps = result.timestamp.get("word", [])
            logger.info(f"Segments: {len(seg_timestamps)}, Words: {len(word_timestamps)}")
            if seg_timestamps:
                logger.info(f"First segment: {seg_timestamps[0]}")
            if word_timestamps:
                logger.info(f"First word: {word_timestamps[0]}")
                logger.info(f"Last word: {word_timestamps[-1]}")

            if seg_timestamps:
                for seg in seg_timestamps:
                    text = (seg.get("segment") or seg.get("text", "")).strip()
                    if text:
                        segments.append({
                            "start": round(seg["start"], 2),
                            "end": round(seg["end"], 2),
                            "text": text,
                        })
            elif word_timestamps:
                chunk: list[dict] = []
                chunk_start = 0.0
                for w in word_timestamps:
                    if not chunk:
                        chunk_start = w["start"]
                    chunk.append(w)
                    word_text = w.get("text", w.get("word", ""))
                    if word_text.endswith((".", "?", "!")) or len(chunk) >= 25:
                        text = " ".join(
                            c.get("text", c.get("word", "")) for c in chunk
                        ).strip()
                        if text:
                            segments.append({
                                "start": round(chunk_start, 2),
                                "end": round(w["end"], 2),
                                "text": text,
                            })
                        chunk = []
                if chunk:
                    text = " ".join(
                        c.get("text", c.get("word", "")) for c in chunk
                    ).strip()
                    if text:
                        segments.append({
                            "start": round(chunk_start, 2),
                            "end": round(chunk[-1]["end"], 2),
                            "text": text,
                        })

        if not segments and hasattr(result, "text") and result.text:
            segments.append({
                "start": 0.0,
                "end": 0.0,
                "text": result.text.strip(),
            })

        logger.info(f"Transcription terminée: {len(segments)} segments")
        return {
            "segments": segments,
            "duration": segments[-1]["end"] if segments else 0,
            "file_name": file.filename,
            "mode": "parakeet-v3",
        }
    finally:
        os.unlink(tmp_path)
        if wav_path and os.path.exists(wav_path):
            os.unlink(wav_path)


MOCK_PHRASES = [
    "Bonsoir et bienvenue dans notre émission.",
    "Les dernières informations montrent une reprise progressive.",
    "Le président a annoncé de nouvelles mesures.",
    "Les experts alertent sur les conséquences du réchauffement.",
    "Dans le domaine sportif, les résultats ont surpris.",
    "La technologie continue de transformer notre quotidien.",
    "Les marchés financiers ont réagi positivement.",
    "La situation internationale reste préoccupante.",
    "Les collectivités investissent dans les transports.",
    "L'éducation nationale prépare une réforme importante.",
]


async def transcribe_mock(file: UploadFile):
    """Transcription simulée (mode développement sans GPU)."""
    content = await file.read()
    file_size = len(content)
    duration_estimate = max(60, file_size // 16000)
    num_segments = max(3, duration_estimate // 30)

    segments = []
    current_time = 0.0
    for _ in range(num_segments):
        segment_duration = random.uniform(15.0, 45.0)
        end_time = current_time + segment_duration
        segments.append({
            "start": round(current_time, 2),
            "end": round(end_time, 2),
            "text": random.choice(MOCK_PHRASES),
        })
        current_time = end_time + random.uniform(0.5, 2.0)

    time.sleep(0.5)
    return {
        "segments": segments,
        "duration": round(current_time, 2),
        "file_name": file.filename,
        "mode": "mock",
    }
