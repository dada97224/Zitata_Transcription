import { Worker } from "bullmq";
import IORedis from "ioredis";
import { config } from "../config";
import { pool } from "../db";

export function startWorker(): void {
  const connection = new IORedis(config.redisUrl, {
    maxRetriesPerRequest: null,
  });

  const worker = new Worker(
    "transcribe-youtube",
    async (job) => {
      const { videoId, emissionId } = job.data as {
        videoId: string;
        emissionId: number;
      };
      console.log(`Transcription démarrée pour ${videoId}`);

      try {
        const audioPath = `${config.downloadDir}/${videoId}.mp3`;

        const { execSync } = await import("child_process");
        try {
          execSync(
            `yt-dlp --extract-audio --audio-format mp3 -o "${audioPath}" "https://www.youtube.com/watch?v=${videoId}"`,
            { timeout: 600000 }
          );
        } catch {
          console.error(`yt-dlp non disponible ou erreur pour ${videoId}`);
          throw new Error("Échec du téléchargement audio");
        }

        const formData = new FormData();
        const { readFileSync } = await import("fs");
        const audioBuffer = readFileSync(audioPath);
        formData.append(
          "file",
          new Blob([audioBuffer], { type: "audio/mpeg" }),
          `${videoId}.mp3`
        );

        const response = await fetch(`${config.asrUrl}/transcribe`, {
          method: "POST",
          body: formData,
        });

        if (!response.ok) {
          throw new Error(`ASR répondu ${response.status}`);
        }

        const data = (await response.json()) as {
          segments: Array<{ start: number; end: number; text: string }>;
        };

        for (let i = 0; i < data.segments.length; i++) {
          const seg = data.segments[i];
          await pool.query(
            `INSERT INTO segments (emission_id, segment_number, start_sec, end_sec, texte)
             VALUES ($1, $2, $3, $4, $5)`,
            [emissionId, i + 1, seg.start, seg.end, seg.text]
          );
        }

        await pool.query(
          "UPDATE emissions SET status_transcription = 'done', updated_at = NOW() WHERE id = $1",
          [emissionId]
        );

        console.log(
          `Transcription terminée pour ${videoId}: ${data.segments.length} segments`
        );
      } catch (err) {
        await pool.query(
          "UPDATE emissions SET status_transcription = 'error', updated_at = NOW() WHERE id = $1",
          [emissionId]
        );
        throw err;
      }
    },
    { connection, concurrency: 1 }
  );

  worker.on("failed", (job, err) => {
    console.error(`Job ${job?.id} échoué:`, err.message);
  });

  worker.on("completed", (job) => {
    console.log(`Job ${job.id} terminé`);
  });
}
