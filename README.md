# Zitata Transcription

Transcription des émissions de la chaîne en texte pour stockage en base de données vectorielles dans un but de recherche de sujets/noms/mots avec timecode de correspondance.

## Architecture

```
Frontend (Next.js) ←→ Backend API ←→ Postgres (segments full-text)
                                       ↑
YouTube API ← Import vidéos ← Backend  Redis (cache + BullMQ jobs)
                                       ↑
Service ASR ← Audio extrait ← Backend (via yt-dlp)
```

### Services

| Service | Port | Description |
|---------|------|-------------|
| `db` | 5432 | PostgreSQL 16 (segments + full-text search) |
| `redis` | 6379 | Cache + file d'attente jobs |
| `asr` | 8001 | Service ASR (mock dev / Parakeet v3 prod) |
| `backend` | 3001 | API REST + workers transcription |
| `frontend` | 3000 | Next.js + YouTube player intégré |

## Démarrage rapide

### Tout en Docker (recommandé pour dev)

Une seule commande lance **toute la stack** (DB, Redis, PO Token, ASR, backend, frontend). Le code **backend** et **frontend** est monté en volume : **tes modifications sont prises en compte sans rebuild**.

```bash
# Depuis la racine du projet (où se trouve .env)
docker compose -f docker-compose.dev-stack.yml up -d --build
```

- **Frontend** : http://localhost:3000 (Next.js en mode dev, rechargement à chaud)
- **Backend** : http://localhost:3001 (tsx watch, redémarre à chaque changement de fichier)
- **ASR** : port 8001 (pour changer le code ASR, rebuild : voir ci‑dessous)

**Resynchroniser quand tu modifies le code :**

| Où tu modifies | Action |
|----------------|--------|
| **Backend** (`backend/src/...`) | Rien à faire : le processus redémarre tout seul (tsx watch). |
| **Frontend** (`frontend/...`) | Rien à faire : le navigateur se rafraîchit (HMR Next.js). |
| **ASR** (`asr/...`) | Rebuild du service : `docker compose -f docker-compose.dev-stack.yml up -d --build asr` |

Pour **tout** reconstruire (après un `git pull` qui change les deps, etc.) :

```bash
docker compose -f docker-compose.dev-stack.yml up -d --build
```

Voir les logs (pour débugger la transcription par ex.) :

```bash
docker compose -f docker-compose.dev-stack.yml logs -f backend
```

**Fichiers audio téléchargés** : avec la stack dev, les MP3 sont écrits dans `backend/downloads/` sur ta machine (montage du volume). Tu peux vérifier qu’un fichier `{videoId}.mp3` est bien présent après le téléchargement.

#### ASR avec GPU (Parakeet sur RTX 4060 Ti, etc.)

La stack utilise par défaut l’image **Dockerfile.gpu** pour l’ASR et réserve 1 GPU NVIDIA. Pour que le conteneur voie le GPU :

- **Windows (Docker Desktop)** : pilote NVIDIA à jour, WSL2 activé, moteur Docker sur WSL2. Si le GPU n’est pas vu, dans WSL2 : `nvidia-smi` doit fonctionner ; installer [NVIDIA Container Toolkit](https://docs.nvidia.com/datacenter/cloud-native/container-toolkit/install-guide.html) dans ta distro WSL2 si besoin.
- **Linux** : installer le [NVIDIA Container Toolkit](https://docs.nvidia.com/datacenter/cloud-native/container-toolkit/install-guide.html), puis redémarrer Docker.

Vérifier que le conteneur ASR utilise le GPU :

```bash
docker compose -f docker-compose.dev-stack.yml exec asr python -c "import torch; print('CUDA:', torch.cuda.is_available(), torch.cuda.get_device_name(0) if torch.cuda.is_available() else '')"
```

Les logs ASR au démarrage doivent afficher un message du type « GPU CUDA détecté : NVIDIA GeForce RTX 4060 Ti ».

**VRAM et longs audios** : pour limiter les erreurs « out of memory » sur les vidéos longues, le service ASR :
- utilise au plus **85 %** de la VRAM du GPU (configurable via `ASR_CUDA_MEMORY_FRACTION`, ex. `0.8` pour 80 %) ;
- découpe les audios de plus de **3 min** en segments de 3 min, transcrit chaque segment puis recolle les timecodes (configurable via `ASR_CHUNK_DURATION_SEC`, ex. `120` pour 2 min). Plus le segment est court, moins la VRAM est utilisée, au prix d’un temps de traitement plus long.
- un **chevauchement** entre chunks (`ASR_CHUNK_OVERLAP_SEC`, défaut 30 s) limite les trous aux jonctions. Les tout premiers secondes (générique, silence) peuvent encore manquer si le modèle n’en produit pas.

**Logs « entraînement » au chargement** : au démarrage, NeMo peut afficher des avertissements sur la config train/validation ; c’est normal (modèle en inférence uniquement) et ces messages sont réduits au minimum.

### Avec Docker Compose (production, sans montage de code)

```bash
# Configurer les variables
cp .env.example .env
# Éditer .env avec votre clé YouTube API

# Lancer tous les services (code figé dans l’image)
docker compose up -d --build
```

Après une modification du code, il faut **rebuild** les services concernés :  
`docker compose up -d --build` ou `docker compose up -d --build backend frontend`.

### Développement (sans Docker pour backend/frontend)

```bash
# 1. Lancer l'infrastructure
docker compose -f docker-compose.dev.yml up -d

# 2. Installer les dépendances
cd backend && npm install && cd ..
cd frontend && npm install && cd ..
cd asr && pip install -r requirements.txt && cd ..

# 3. Lancer les services
cd asr && uvicorn server:app --host 0.0.0.0 --port 8001 &
cd backend && npm run dev &
cd frontend && npm run dev &

# 4. Importer les vidéos de votre chaîne (bouton sur /youtube ou) :
curl -X POST http://localhost:3001/youtube/import-channel

# 5. Ouvrir http://localhost:3000 — page Vidéos YouTube pour lister/transcrire, accueil pour la recherche
```

### Debug : transcription en erreur

1. **Vérifier que tout tourne** : `GET http://localhost:3001/health/diagnostics`  
   Réponse : état de la **base** (nombre d’émissions/segments), **Redis** (file d’attente), **ASR** (mode parakeet ou mock).

2. **Logs backend** : au clic sur « Transcrire », le worker log chaque étape (téléchargement yt-dlp, envoi ASR, écriture segments). En cas d’erreur, le message complet s’affiche dans la console du backend.

3. **Causes fréquentes** : yt-dlp (cookies YouTube, réseau), ASR injoignable (vérifier que le service ASR tourne sur le port 8001), ou erreur d’écriture en base.

## API Endpoints

| Méthode | URL | Description |
|---------|-----|-------------|
| `GET` | `/health` | Santé du backend + DB |
| `GET` | `/health/diagnostics` | État DB, Redis, ASR (debug) |
| `POST` | `/youtube/import-channel` | Importer les vidéos de la chaîne YouTube (.env) |
| `GET` | `/youtube/videos` | Liste des vidéos importées |
| `POST` | `/youtube/:videoId/transcribe` | Lancer la transcription d'une vidéo |
| `GET` | `/youtube/:videoId` | Détail vidéo + segments transcrits |
| `GET` | `/recherche?q=...&limit=20` | Recherche full-text dans les segments (timecodes) |

## Variables d'environnement

| Variable | Description | Défaut |
|----------|-------------|--------|
| `YOUTUBE_API_KEY` | Clé YouTube Data API v3 | - |
| `YOUTUBE_CHANNEL_ID` | ID de la chaîne YouTube | - |
| `DATABASE_URL` | URL PostgreSQL (dev : port 5433 si Postgres local sur 5432) | `postgres://zitata:zitata_dev@localhost:5433/zitata` |
| `REDIS_URL` | URL Redis | `redis://localhost:6379` |
| `ASR_URL` | URL du service ASR | `http://localhost:8001` |
| `NEXT_PUBLIC_API_URL` | URL backend pour le frontend | `http://localhost:3001` |
