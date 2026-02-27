# AGENTS.md

## Cursor Cloud specific instructions

### Architecture

Monorepo avec 6 services Docker :

| Service | Port | Techno | Rôle |
|---------|------|--------|------|
| `db` | 5432 | PostgreSQL 16 | Stockage émissions + segments, full-text search (GIN, trigram) |
| `redis` | 6379 | Redis 7 | Cache + file d'attente BullMQ |
| `pot-provider` | 4416 | bgutil-ytdlp-pot-provider | Génération de PO Tokens pour bypass anti-bot YouTube |
| `asr` | 8001 | Python/FastAPI | Service ASR (mock en dev, Parakeet v3 en prod) |
| `backend` | 3001 | Node.js/Express/TypeScript | API REST + workers BullMQ |
| `frontend` | 3000 | Next.js 14/Tailwind | UI recherche + player YouTube |

### Démarrage rapide (dev)

1. Infra : `docker compose -f docker-compose.dev.yml up -d` (Postgres + Redis + PO Token provider)
2. ASR : `cd asr && uvicorn server:app --host 0.0.0.0 --port 8001`
3. Backend : `cd backend && npx tsx src/index.ts` (applique les migrations auto)
4. Frontend : `cd frontend && npm run dev`
5. Seed données test : `curl -X POST http://localhost:3001/youtube/seed`

### Commandes lint/test/build

- Backend lint : `cd backend && npm run lint` (tsc --noEmit)
- Backend tests : `cd backend && npm test` (vitest)
- Frontend lint : `cd frontend && npm run lint` (next lint)
- Frontend build : `cd frontend && npm run build`

### Gotchas

- Docker nécessite `fuse-overlayfs` + `iptables-legacy` dans l'environnement Cloud Agent (conteneur Docker-in-Docker).
- Le backend applique automatiquement les migrations SQL au démarrage via `initDb()`.
- BullMQ utilise des objets `{host, port}` pour la connexion Redis (pas d'instance IORedis directe) pour éviter les conflits de types.
- Le service ASR est en mode **mock** en dev : il retourne des segments simulés. En production, remplacer par Parakeet v3.
- `YOUTUBE_API_KEY` et `YOUTUBE_CHANNEL_ID` sont optionnels en dev ; utiliser `POST /youtube/seed` pour injecter des données de test.
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
