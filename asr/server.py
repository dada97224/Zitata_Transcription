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
import threading

from fastapi import FastAPI, UploadFile, File
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("zitata-asr")

ASR_MODE = os.environ.get("ASR_MODE", "auto")
ASR_MODEL = os.environ.get("ASR_MODEL", "Archime/parakeet-tdt-0.6b-v3-fr-tv-media")
# Fraction de VRAM utilisable (0.0–1.0). Réduire (ex. 0.8) pour éviter OOM sur longs audios.
ASR_CUDA_MEMORY_FRACTION = float(os.environ.get("ASR_CUDA_MEMORY_FRACTION", "0.95"))
# Durée max d'un segment à envoyer au modèle (secondes). Plus court = moins de VRAM, plus de temps.
ASR_CHUNK_DURATION_SEC = float(os.environ.get("ASR_CHUNK_DURATION_SEC", "400"))
# Chevauchement entre deux chunks (secondes) pour limiter les trous aux jonctions.
ASR_CHUNK_OVERLAP_SEC = float(os.environ.get("ASR_CHUNK_OVERLAP_SEC", "40"))

asr_model = None
_model_loading = False  # True tant que le chargement en arrière-plan n'est pas terminé
_model_loading_started_at: float | None = None  # timestamp du début de chargement (pour logs)
_model_loaded_at: float | None = None  # timestamp du dernier chargement (succès ou fallback mock)
_last_error: str | None = None  # dernier message d'erreur de chargement (pour debug /health)

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
            prop = torch.cuda.get_device_properties(0)
            vram = getattr(prop, "total_memory", getattr(prop, "total_mem", 0)) / 1e9
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
    """Charge le modèle Parakeet v3 via NeMo (bloquant, à appeler en thread)."""
    global asr_model, ASR_MODE, _model_loading, _model_loaded_at, _last_error
    try:
        _last_error = None
        # Réduire les logs NeMo liés à l'entraînement (config train/val) au chargement du modèle
        for _name in ("nemo_logger", "nemo", "NeMo"):
            _log = logging.getLogger(_name)
            if _log.level == logging.NOTSET:
                _log.setLevel(logging.WARNING)
        logging.getLogger("nv_one_logger").setLevel(logging.WARNING)

        logger.info("Début du chargement du modèle Parakeet (peut prendre 5–10 min)...")
        import torch
        import nemo.collections.asr as nemo_asr

        device = detect_device()
        logger.info(f"Chargement du modèle {ASR_MODEL} sur {device}...")
        asr_model = nemo_asr.models.ASRModel.from_pretrained(model_name=ASR_MODEL)

        # Désactiver le décodage CUDA Graphs via change_decoding_strategy (workaround bug cu_call 6 vs 5)
        try:
            if hasattr(asr_model, "change_decoding_strategy"):
                from nemo.collections.asr.parts.submodules.rnnt_decoding import RNNTDecodingConfig
                tdt_decoding = RNNTDecodingConfig(strategy="greedy_batch", model_type="tdt", fused_batch_size=-1)
                if hasattr(tdt_decoding, "greedy"):
                    tdt_decoding.greedy.use_cuda_graph_decoder = False
                else:
                    setattr(tdt_decoding, "use_cuda_graph_decoder", False)
                asr_model.change_decoding_strategy(tdt_decoding)
                logger.info("Désactivation CUDA Graphs via change_decoding_strategy(use_cuda_graph_decoder=False)")
            else:
                decoding_cfg = getattr(asr_model, "decoding_cfg", None) or getattr(asr_model, "decoding", None)
                for attr in ("use_cuda_graph_decoder", "use_cuda_graphs"):
                    if hasattr(decoding_cfg, attr):
                        setattr(decoding_cfg, attr, False)
                        logger.info(f"Désactivation de {attr} dans decoding_cfg (CUDA Graphs).")
                    if hasattr(asr_model, attr):
                        setattr(asr_model, attr, False)
                        logger.info(f"Désactivation de {attr} sur le modèle (CUDA Graphs).")
        except Exception as dec_err:
            logger.warning(f"Impossible de désactiver CUDA Graphs dans NeMo: {dec_err}")

        if device == "cuda":
            asr_model = asr_model.cuda()
            # Limiter l'usage VRAM pour éviter OOM sur longs audios (segments plus courts traités)
            if 0 < ASR_CUDA_MEMORY_FRACTION < 1:
                torch.cuda.set_per_process_memory_fraction(ASR_CUDA_MEMORY_FRACTION, 0)
                logger.info(f"VRAM limitée à {ASR_CUDA_MEMORY_FRACTION*100:.0f}% du GPU")
        elif device == "mps":
            asr_model = asr_model.to(torch.device("mps"))

        ASR_MODE = "parakeet"
        _model_loaded_at = time.time()
        logger.info(f"Modèle {ASR_MODEL} chargé sur {device} — mode parakeet actif (chunks {ASR_CHUNK_DURATION_SEC:.0f}s)")
    except Exception as e:
        _last_error = str(e)
        logger.warning(f"Impossible de charger Parakeet: {e}")
        if ASR_MODE == "parakeet":
            logger.error("Mode parakeet requis mais modèle indisponible — le service restera en 503.")
        ASR_MODE = "mock"
        _model_loaded_at = time.time()
        logger.info("Fallback en mode mock")
    finally:
        _model_loading = False


def _loading_watchdog():
    """Si le chargement dépasse 15 min, bascule en mock pour que le service redevienne disponible."""
    global _model_loading, ASR_MODE
    time.sleep(900)  # 15 min
    if _model_loading:
        logger.warning("Chargement Parakeet abandonné après 15 min (timeout) — mode mock actif.")
        _model_loading = False
        ASR_MODE = "mock"
        logger.info("ASR disponible en mode mock.")


@app.on_event("startup")
async def startup():
    """Démarre le serveur tout de suite ; charge le modèle en arrière-plan pour accepter /health dès le début."""
    global _model_loading, _model_loading_started_at
    if ASR_MODE in ("auto", "parakeet"):
        _model_loading = True
        _model_loading_started_at = time.time()
        thread = threading.Thread(target=load_parakeet, daemon=True)
        thread.start()
        watchdog = threading.Thread(target=_loading_watchdog, daemon=True)
        watchdog.start()
        logger.info("Serveur prêt (port 8001 ouvert). Chargement du modèle Parakeet en arrière-plan...")
    else:
        logger.info("Mode mock forcé par ASR_MODE=mock")


@app.get("/health")
async def health():
    """Renvoie l'état détaillé du service ASR.

    - 503 pendant le chargement du modèle (ou si non disponible).
    - 200 quand le modèle est prêt (mode parakeet) ou en mock.
    """
    now = time.time()
    loading = _model_loading or (ASR_MODE in ("auto", "parakeet") and asr_model is None)
    loaded_since = None
    if _model_loaded_at is not None:
        loaded_since = max(0, int(now - _model_loaded_at))

    if loading:
        loading_for = None
        if _model_loading_started_at is not None:
            loading_for = max(0, int(now - _model_loading_started_at))
        return JSONResponse(
            status_code=503,
            content={
                "status": "loading",
                "service": "zitata-asr",
                "mode": ASR_MODE,
                "model": ASR_MODEL,
                "loading_for_sec": loading_for,
                "last_error": _last_error,
            },
        )

    return {
        "status": "ok",
        "service": "zitata-asr",
        "mode": ASR_MODE,
        "model": ASR_MODEL if ASR_MODE == "parakeet" else None,
        "loading": False,
        "loaded_since_sec": loaded_since,
        "last_error": _last_error,
    }


@app.post("/transcribe")
async def transcribe(file: UploadFile = File(...)):
    if ASR_MODE == "parakeet" and asr_model is None:
        return JSONResponse(
            status_code=503,
            content={"error": "Modèle en cours de chargement, réessayez dans quelques minutes."},
        )
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


def get_audio_duration_sec(wav_path: str) -> float:
    """Retourne la durée en secondes via ffprobe."""
    import subprocess
    out = subprocess.run(
        [
            "ffprobe", "-v", "error", "-show_entries", "format=duration",
            "-of", "default=noprint_wrappers=1:nokey=1", wav_path,
        ],
        capture_output=True,
        text=True,
        check=True,
    )
    return float(out.stdout.strip())


def extract_wav_chunk(wav_path: str, start_sec: float, duration_sec: float, out_path: str) -> None:
    """Extrait un segment [start_sec, start_sec+duration_sec] en WAV mono 16kHz."""
    import subprocess
    subprocess.run(
        [
            "ffmpeg", "-y", "-i", wav_path, "-ss", str(start_sec), "-t", str(duration_sec),
            "-ac", "1", "-ar", "16000", out_path,
        ],
        capture_output=True,
        check=True,
    )


def _result_to_segments(result, time_offset: float = 0.0) -> list[dict]:
    """Convertit le résultat NeMo en liste de segments avec offset temporel."""
    segments = []
    if not hasattr(result, "timestamp") or not result.timestamp:
        if hasattr(result, "text") and result.text:
            segments.append({"start": time_offset, "end": time_offset, "text": result.text.strip()})
        return segments
    seg_timestamps = result.timestamp.get("segment", [])
    word_timestamps = result.timestamp.get("word", [])
    if seg_timestamps:
        for seg in seg_timestamps:
            text = (seg.get("segment") or seg.get("text", "")).strip()
            if text:
                segments.append({
                    "start": round(seg["start"] + time_offset, 2),
                    "end": round(seg["end"] + time_offset, 2),
                    "text": text,
                })
    elif word_timestamps:
        chunk: list = []
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
                        "start": round(chunk_start + time_offset, 2),
                        "end": round(w["end"] + time_offset, 2),
                        "text": text,
                    })
                chunk = []
        if chunk:
            text = " ".join(
                c.get("text", c.get("word", "")) for c in chunk
            ).strip()
            if text:
                segments.append({
                    "start": round(chunk_start + time_offset, 2),
                    "end": round(chunk[-1]["end"] + time_offset, 2),
                    "text": text,
                })
    return segments


async def transcribe_parakeet(file: UploadFile):
    """Transcription réelle via Parakeet v3."""
    content = await file.read()

    suffix = os.path.splitext(file.filename or "audio.mp3")[1] or ".mp3"
    with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as tmp:
        tmp.write(content)
        tmp_path = tmp.name

    wav_path = None
    chunk_paths_to_clean: list[str] = []
    try:
        wav_path = convert_to_mono_wav(tmp_path)
        duration_sec = get_audio_duration_sec(wav_path)
        logger.info(f"Transcription de {file.filename} ({len(content)} octets, {duration_sec:.1f}s)...")

        import torch
        if torch.cuda.is_available():
            torch.cuda.empty_cache()

        segments: list[dict] = []
        chunk_dur = max(30.0, ASR_CHUNK_DURATION_SEC)
        overlap_sec = max(0.0, min(ASR_CHUNK_OVERLAP_SEC, chunk_dur * 0.5))
        step_sec = chunk_dur - overlap_sec  # pas entre débuts de chunks (avec overlap)

        if duration_sec <= chunk_dur:
            output = asr_model.transcribe([wav_path], timestamps=True)
            segments = _result_to_segments(output[0], 0.0)
        else:
            num_chunks = max(1, int((duration_sec - overlap_sec) / step_sec) + (1 if (duration_sec - overlap_sec) % step_sec > 0.5 else 0))
            logger.info(f"Audio long: découpage en {num_chunks} segments de ~{chunk_dur:.0f}s (overlap {overlap_sec:.0f}s) pour limiter la VRAM")
            for i in range(num_chunks):
                start_sec = i * step_sec
                seg_dur = min(chunk_dur, duration_sec - start_sec)
                if seg_dur < 0.5:
                    break
                chunk_path = tempfile.mktemp(suffix=".wav", prefix="asr_chunk_")
                chunk_paths_to_clean.append(chunk_path)
                try:
                    extract_wav_chunk(wav_path, start_sec, seg_dur, chunk_path)
                    output = asr_model.transcribe([chunk_path], timestamps=True)
                    chunk_segments = _result_to_segments(output[0], start_sec)
                    # À partir du 2e chunk, on ignore les segments dans la zone de chevauchement (déjà couverts par le chunk précédent)
                    if i > 0 and overlap_sec > 0:
                        cut = start_sec + overlap_sec
                        chunk_segments = [s for s in chunk_segments if s["start"] >= cut]
                    segments.extend(chunk_segments)
                    logger.info(f"  Segment {i+1}/{num_chunks} (à {start_sec:.0f}s) : {len(chunk_segments)} segments retenus")
                finally:
                    if os.path.exists(chunk_path):
                        os.unlink(chunk_path)
                    if torch.cuda.is_available():
                        torch.cuda.empty_cache()
            segments.sort(key=lambda s: (s["start"], s["end"]))

        if not segments and duration_sec <= chunk_dur:
            # Fallback uniquement pour audio court (éviter OOM en retraitant tout le fichier)
            output = asr_model.transcribe([wav_path], timestamps=True)
            result = output[0]
            if hasattr(result, "text") and result.text:
                segments.append({"start": 0.0, "end": duration_sec, "text": result.text.strip()})

        total_duration = segments[-1]["end"] if segments else duration_sec
        logger.info(f"Transcription terminée: {len(segments)} segments")
        return {
            "segments": segments,
            "duration": total_duration,
            "file_name": file.filename,
            "mode": "parakeet-v3",
        }
    except Exception:
        # Nettoyer les chunks temporaires en cas d'erreur
        for p in chunk_paths_to_clean:
            if os.path.exists(p):
                try:
                    os.unlink(p)
                except OSError:
                    pass
        raise
    finally:
        try:
            import torch
            if torch.cuda.is_available():
                torch.cuda.empty_cache()
        except Exception:
            pass
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
