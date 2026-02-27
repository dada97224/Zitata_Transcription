# Setup ASR — Mac Mini M4

## Prérequis

- macOS 14+ (Sonoma ou plus)
- Python 3.11+ (`brew install python@3.12`)
- ffmpeg (`brew install ffmpeg`)

## Installation

```bash
cd asr

# Créer un virtualenv
python3 -m venv .venv
source .venv/bin/activate

# Installer PyTorch pour Apple Silicon (MPS)
pip install torch torchaudio --index-url https://download.pytorch.org/whl/cpu

# Installer NeMo et dépendances
pip install -r requirements.txt

# Lancer le service
ASR_MODE=parakeet uvicorn server:app --host 0.0.0.0 --port 8001
```

Le service détecte automatiquement le backend MPS (Metal Performance Shaders) d'Apple Silicon.

## Vérifier

```bash
curl http://localhost:8001/health
# {"status":"ok","mode":"parakeet","model":"Archime/parakeet-tdt-0.6b-v3-fr-tv-media"}
```

Les logs doivent afficher :
```
Apple MPS détecté (Mac M-series)
Modèle Archime/parakeet-tdt-0.6b-v3-fr-tv-media chargé sur mps — mode parakeet actif
```

## Performance attendue (Mac Mini M4)

Le M4 a un Neural Engine puissant. Performances estimées :

| Durée audio | Temps transcription |
|-------------|-------------------|
| 2 min       | ~3 secondes       |
| 30 min      | ~1–2 minutes      |
| 1 heure     | ~3–5 minutes      |

## Connecter au backend principal

```bash
ASR_URL=http://<IP_MAC>:8001
```

## Notes

- Le support MPS de NeMo est expérimental — en cas de problème, le service fallback sur CPU
- Pour un cluster de Mac Mini M4, lancer un service ASR par machine et distribuer les jobs via BullMQ
- Le M4 Pro/Max sera plus rapide grâce au bandwidth mémoire supérieur
