import { config as loadEnv } from "dotenv";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { tmpdir } from "os";

// Charger .env depuis la racine du monorepo si présent (en Docker les env viennent du compose)
const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = join(__dirname, "..", "..");
loadEnv({ path: join(rootDir, ".env"), encoding: "utf-8" });

// Dossier de téléchargement : compatible Windows (tmpdir) si DOWNLOAD_DIR non défini
const defaultDownloadDir = join(tmpdir(), "zitata-youtube-downloads");

export const config = {
  port: parseInt(process.env.PORT || "3001"),
  databaseUrl:
    process.env.DATABASE_URL ||
    "postgres://zitata:zitata_dev@127.0.0.1:5433/zitata",
  redisUrl: process.env.REDIS_URL || "redis://localhost:6379",
  asrUrl: process.env.ASR_URL || "http://localhost:8001",
  youtubeApiKey: process.env.YOUTUBE_API_KEY || "",
  youtubeChannelId: process.env.YOUTUBE_CHANNEL_ID || "",
  downloadDir: process.env.DOWNLOAD_DIR || defaultDownloadDir,
  potProviderUrl: process.env.POT_PROVIDER_URL || "http://localhost:4416",
  ytCookiesPath: process.env.YT_COOKIES_PATH || "",
};
