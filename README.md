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

### Avec Docker Compose (production)

```bash
# Configurer les variables
cp .env.example .env
# Éditer .env avec votre clé YouTube API

# Lancer tous les services
docker compose up -d
```

### Développement

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

# 4. Injecter des données de test
curl -X POST http://localhost:3001/youtube/seed

# 5. Ouvrir http://localhost:3000 et rechercher "ouragan"
```

## API Endpoints

| Méthode | URL | Description |
|---------|-----|-------------|
| `GET` | `/health` | Vérification santé du service |
| `POST` | `/youtube/import-channel` | Importer toutes les vidéos d'une chaîne YouTube |
| `GET` | `/youtube/videos` | Liste des vidéos importées |
| `POST` | `/youtube/:videoId/transcribe` | Lancer la transcription d'une vidéo |
| `GET` | `/youtube/:videoId` | Détail vidéo + segments transcrits |
| `GET` | `/recherche?q=...&limit=20` | Recherche full-text dans les segments |
| `POST` | `/youtube/seed` | Injecter des données de test (dev) |

## Variables d'environnement

| Variable | Description | Défaut |
|----------|-------------|--------|
| `YOUTUBE_API_KEY` | Clé YouTube Data API v3 | - |
| `YOUTUBE_CHANNEL_ID` | ID de la chaîne YouTube | - |
| `DATABASE_URL` | URL PostgreSQL | `postgres://zitata:zitata_dev@localhost:5432/zitata` |
| `REDIS_URL` | URL Redis | `redis://localhost:6379` |
| `ASR_URL` | URL du service ASR | `http://localhost:8001` |
| `NEXT_PUBLIC_API_URL` | URL backend pour le frontend | `http://localhost:3001` |
