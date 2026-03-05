# AGENTS.md

## Cursor Cloud specific instructions

### Architecture

Monorepo avec 6 services Docker :

| Service | Port | Techno | Rôle |
|---------|------|--------|------|
| `db` | 5432 | PostgreSQL 16 | Stockage émissions + segments, full-text search (GIN, trigram) |
| `redis` | 6379 | Redis 7 | Cache + file d'attente BullMQ |
| `pot-provider` | 4416 | bgutil-ytdlp-pot-provider | Génération de PO Tokens pour bypass anti-bot YouTube |
| `asr` | 8001 | Python/FastAPI/NeMo | Parakeet v3 ASR (auto-détection GPU/CPU, fallback mock) |
| `backend` | 3001 | Node.js/Express/TypeScript | API REST + workers BullMQ |
| `frontend` | 3000 | Next.js 14/Tailwind | UI recherche + player YouTube |

### Démarrage rapide (dev)

1. Infra : `docker compose -f docker-compose.dev.yml up -d` (Postgres + Redis + PO Token provider)
2. ASR : `cd asr && uvicorn server:app --host 0.0.0.0 --port 8001`
3. Backend : `cd backend && npx tsx src/index.ts` (applique les migrations auto)
4. Frontend : `cd frontend && npm run dev`
5. Import vidéos : `curl -X POST http://localhost:3001/youtube/import-channel`

### Commandes lint/test/build

- Backend lint : `cd backend && npm run lint` (tsc --noEmit)
- Backend tests : `cd backend && npm test` (vitest)
- Frontend lint : `cd frontend && npm run lint` (next lint)
- Frontend build : `cd frontend && npm run build`

### Gotchas

- Docker nécessite `fuse-overlayfs` + `iptables-legacy` dans l'environnement Cloud Agent (conteneur Docker-in-Docker).
- Le backend applique automatiquement les migrations SQL au démarrage via `initDb()`.
- BullMQ utilise des objets `{host, port}` pour la connexion Redis (pas d'instance IORedis directe) pour éviter les conflits de types.
- **Service ASR** : utilise le modèle `Archime/parakeet-tdt-0.6b-v3-fr-tv-media` (fine-tuné pour la TV/radio française). Variable `ASR_MODE` : `auto` (détection GPU→parakeet, sinon mock), `parakeet` (force), `mock` (simulé). Variable `ASR_MODEL` pour changer le modèle. En CPU, la transcription d'un audio >5 min est très lente — GPU recommandé. L'audio doit être converti en WAV mono 16kHz avant transcription (fait automatiquement via ffmpeg).
- `YOUTUBE_API_KEY` et `YOUTUBE_CHANNEL_ID` sont nécessaires pour importer les vidéos.
- La recherche full-text utilise la configuration `french` de PostgreSQL. Les requêtes ILIKE servent de fallback pour les termes non indexés.
- Le backend doit être lancé avec `PATH` incluant `/home/ubuntu/.local/bin` et le chemin Node.js pour que `yt-dlp` et `uvicorn` soient accessibles.

### Bypass anti-bot YouTube (yt-dlp)

YouTube bloque les téléchargements depuis les IPs de datacenter. Trois éléments sont nécessaires pour le contourner :

1. **Cookies YouTube** (obligatoire sur IP datacenter) :
   - Se connecter à YouTube dans Chrome (Desktop pane ou navigateur local)
   - Exporter : `yt-dlp --cookies-from-browser chrome --cookies ./cookies/youtube_cookies.txt --skip-download "https://www.youtube.com/watch?v=dQw4w9WgXcQ"`
   - Configurer : `YT_COOKIES_PATH=./cookies/youtube_cookies.txt`
   - Ou utiliser le script : `./scripts/export-youtube-cookies.sh`

2. **PO Token provider** (recommandé, améliore la fiabilité) :
   - Déjà inclus dans `docker-compose.dev.yml` sur le port 4416
   - Plugin yt-dlp : `pip install bgutil-ytdlp-pot-provider`
   - Variable : `GETPOT_BGUTIL_BASEURL=http://localhost:4416`

3. **JS Runtime + Solver** (obligatoire pour résoudre les signatures) :
   - Node.js doit être dans le PATH
   - Ajouter `--js-runtimes node --remote-components ejs:github` à yt-dlp

Sans cookies, utiliser `POST /youtube/seed` pour injecter des données de test.
