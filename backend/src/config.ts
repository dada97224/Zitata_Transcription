import "dotenv/config";

export const config = {
  port: parseInt(process.env.PORT || "3001"),
  databaseUrl:
    process.env.DATABASE_URL ||
    "postgres://zitata:zitata_dev@localhost:5432/zitata",
  redisUrl: process.env.REDIS_URL || "redis://localhost:6379",
  asrUrl: process.env.ASR_URL || "http://localhost:8001",
  youtubeApiKey: process.env.YOUTUBE_API_KEY || "",
  youtubeChannelId: process.env.YOUTUBE_CHANNEL_ID || "",
  downloadDir: process.env.DOWNLOAD_DIR || "/tmp/youtube-downloads",
};
