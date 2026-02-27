"""
Service ASR (Automatic Speech Recognition) - Mode développement.
En production, ce service utilise Parakeet v3 (NVIDIA NeMo).
En dev, il retourne des segments simulés pour tester le pipeline.
"""

import random
import time
from fastapi import FastAPI, UploadFile, File
from fastapi.middleware.cors import CORSMiddleware

app = FastAPI(title="Zitata ASR Service", version="0.1.0")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])

MOCK_PHRASES = [
    "Bonsoir et bienvenue dans notre émission. Ce soir nous allons aborder plusieurs sujets d'actualité.",
    "Les dernières informations concernant la situation économique montrent une reprise progressive.",
    "Le président a annoncé de nouvelles mesures pour lutter contre le changement climatique.",
    "Les experts scientifiques alertent sur les conséquences du réchauffement global.",
    "Dans le domaine sportif, les résultats du weekend ont surpris de nombreux observateurs.",
    "La technologie continue de transformer notre quotidien avec de nouvelles innovations.",
    "Les marchés financiers ont réagi positivement aux dernières annonces gouvernementales.",
    "La situation internationale reste préoccupante dans plusieurs régions du monde.",
    "Les collectivités locales investissent massivement dans les transports en commun.",
    "L'éducation nationale prépare une réforme importante pour la rentrée prochaine.",
]


@app.get("/health")
async def health():
    return {"status": "ok", "service": "zitata-asr", "mode": "mock"}


@app.post("/transcribe")
async def transcribe(file: UploadFile = File(...)):
    content = await file.read()
    file_size = len(content)

    duration_estimate = max(60, file_size // 16000)
    num_segments = max(3, duration_estimate // 30)

    segments = []
    current_time = 0.0

    for i in range(num_segments):
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
