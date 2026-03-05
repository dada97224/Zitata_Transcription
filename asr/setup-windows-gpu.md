# Setup ASR GPU — Windows RTX 3090

## Prérequis

1. **Windows 11** (ou Windows 10 21H2+)
2. **NVIDIA Driver** ≥ 535 (vérifier : `nvidia-smi`)
3. **Docker Desktop** avec WSL2 backend activé
4. **NVIDIA Container Toolkit** installé dans WSL2

## Installation rapide

### 1. Vérifier le GPU

```powershell
nvidia-smi
# Doit afficher : RTX 3090, Driver 535+, CUDA 12.x
```

### 2. Installer Docker Desktop

- Télécharger : https://www.docker.com/products/docker-desktop/
- Activer WSL2 backend dans Settings → General
- Activer GPU dans Settings → Docker Engine, ajouter :
```json
{
  "runtimes": {
    "nvidia": {
      "path": "nvidia-container-runtime",
      "runtimeArgs": []
    }
  }
}
```

### 3. Lancer le service ASR

```powershell
cd asr
docker compose -f docker-compose.asr-gpu.yml up -d
```

Le premier lancement télécharge le modèle (~2.5 Go). Ensuite il est mis en cache.

### 4. Vérifier

```powershell
curl http://localhost:8001/health
# {"status":"ok","service":"zitata-asr","mode":"parakeet","model":"Archime/parakeet-tdt-0.6b-v3-fr-tv-media"}
```

### 5. Connecter le backend

Sur la machine qui héberge le backend, configurer :

```bash
ASR_URL=http://<IP_WINDOWS>:8001
```

Ou dans `docker-compose.yml` :
```yaml
backend:
  environment:
    ASR_URL: http://<IP_WINDOWS>:8001
```

## Performance attendue

| Durée audio | Temps transcription (RTX 3090) | Temps CPU (pour comparaison) |
|-------------|-------------------------------|------------------------------|
| 2 min       | ~1 seconde                    | ~6 secondes                  |
| 30 min      | ~15 secondes                  | ~15+ minutes                 |
| 1 heure     | ~30 secondes                  | ~30+ minutes                 |

## Dépannage

- **`nvidia-smi` non trouvé** : Installer les drivers NVIDIA
- **Docker GPU non détecté** : `docker run --rm --gpus all nvidia/cuda:12.4.1-base-ubuntu22.04 nvidia-smi`
- **Mémoire GPU insuffisante** : Le modèle utilise ~2 Go VRAM, la RTX 3090 en a 24 Go — aucun problème
- **Pare-feu** : Ouvrir le port 8001 dans le firewall Windows pour permettre l'accès réseau
