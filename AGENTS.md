# AGENTS.md

## Cursor Cloud specific instructions

### Architecture

Monorepo avec 5 services Docker :

| Service | Port | Techno | Rôle |
|---------|------|--------|------|
| `db` | 5432 | PostgreSQL 16 | Stockage émissions + segments, full-text search (GIN, trigram) |
| `redis` | 6379 | Redis 7 | Cache + file d'attente BullMQ |
| `asr` | 8001 | Python/FastAPI | Service ASR (mock en dev, Parakeet v3 en prod) |
| `backend` | 3001 | Node.js/Express/TypeScript | API REST + workers BullMQ |
| `frontend` | 3000 | Next.js 14/Tailwind | UI recherche + player YouTube |

### Démarrage rapide (dev)

1. Infra : `docker compose -f docker-compose.dev.yml up -d` (Postgres + Redis)
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
