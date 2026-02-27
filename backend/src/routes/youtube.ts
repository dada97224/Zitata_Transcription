import { Router, Request, Response } from "express";
import { pool } from "../db";
import { config } from "../config";
import { Queue } from "bullmq";

const router = Router();

function parseRedisUrl(url: string) {
  const parsed = new URL(url);
  return { host: parsed.hostname || "localhost", port: parseInt(parsed.port || "6379") };
}

const transcribeQueue = new Queue("transcribe-youtube", {
  connection: parseRedisUrl(config.redisUrl),
});

router.post("/import-channel", async (_req: Request, res: Response) => {
  if (!config.youtubeApiKey || !config.youtubeChannelId) {
    res.status(400).json({
      error: "YOUTUBE_API_KEY et YOUTUBE_CHANNEL_ID requis",
    });
    return;
  }

  try {
    let pageToken = "";
    let imported = 0;

    do {
      const url = new URL(
        "https://www.googleapis.com/youtube/v3/search"
      );
      url.searchParams.set("key", config.youtubeApiKey);
      url.searchParams.set("channelId", config.youtubeChannelId);
      url.searchParams.set("part", "snippet");
      url.searchParams.set("type", "video");
      url.searchParams.set("maxResults", "50");
      url.searchParams.set("order", "date");
      if (pageToken) url.searchParams.set("pageToken", pageToken);

      const response = await fetch(url.toString());
      const data = await response.json() as {
        items?: Array<{
          id: { videoId: string };
          snippet: { title: string; publishedAt: string; thumbnails: { medium: { url: string } } };
        }>;
        nextPageToken?: string;
      };

      if (!data.items) break;

      for (const item of data.items) {
        const videoId = item.id.videoId;
        const { title, publishedAt, thumbnails } = item.snippet;
        const thumbnailUrl = thumbnails?.medium?.url ||
          `https://img.youtube.com/vi/${videoId}/mqdefault.jpg`;

        await pool.query(
          `INSERT INTO emissions (youtube_video_id, titre, date_diffusion, youtube_url, thumbnail_url)
           VALUES ($1, $2, $3, $4, $5)
           ON CONFLICT (youtube_video_id) DO NOTHING`,
          [
            videoId,
            title,
            publishedAt,
            `https://www.youtube.com/watch?v=${videoId}`,
            thumbnailUrl,
          ]
        );
        imported++;
      }

      pageToken = data.nextPageToken || "";
    } while (pageToken);

    res.json({ message: `${imported} vidéos importées`, imported });
  } catch (err) {
    console.error("Erreur import chaîne:", err);
    res.status(500).json({ error: "Erreur lors de l'import" });
  }
});

router.get("/videos", async (_req: Request, res: Response) => {
  try {
    const { rows } = await pool.query(
      "SELECT * FROM emissions ORDER BY date_diffusion DESC"
    );
    res.json(rows);
  } catch (err) {
    console.error("Erreur liste vidéos:", err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

router.post("/:videoId/transcribe", async (req: Request, res: Response) => {
  const { videoId } = req.params;
  try {
    const { rows } = await pool.query(
      "SELECT id FROM emissions WHERE youtube_video_id = $1",
      [videoId]
    );

    if (rows.length === 0) {
      res.status(404).json({ error: "Vidéo non trouvée" });
      return;
    }

    await transcribeQueue.add("transcribe", {
      videoId,
      emissionId: rows[0].id,
    });

    await pool.query(
      "UPDATE emissions SET status_transcription = 'processing', updated_at = NOW() WHERE youtube_video_id = $1",
      [videoId]
    );

    res.json({ message: "Transcription mise en file d'attente" });
  } catch (err) {
    console.error("Erreur transcription:", err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

router.get("/:videoId", async (req: Request, res: Response) => {
  const { videoId } = req.params;
  try {
    const emission = await pool.query(
      "SELECT * FROM emissions WHERE youtube_video_id = $1",
      [videoId]
    );

    if (emission.rows.length === 0) {
      res.status(404).json({ error: "Vidéo non trouvée" });
      return;
    }

    const segments = await pool.query(
      "SELECT id, segment_number, start_sec, end_sec, texte FROM segments WHERE emission_id = $1 ORDER BY segment_number",
      [emission.rows[0].id]
    );

    res.json({
      emission: emission.rows[0],
      segments: segments.rows,
    });
  } catch (err) {
    console.error("Erreur détail vidéo:", err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

export const youtubeRouter = router;
