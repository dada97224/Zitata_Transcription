import { Worker } from "bullmq";
import { config } from "../config";
import { pool } from "../db";

function parseRedisUrl(url: string) {
  const parsed = new URL(url);
  return { host: parsed.hostname || "localhost", port: parseInt(parsed.port || "6379") };
}

function buildYtDlpCommand(videoId: string, audioPath: string): string {
  const parts = [
    "yt-dlp",
    "--extract-audio",
    "--audio-format mp3",
    "--no-check-certificates",
    "--js-runtimes node",
    "--remote-components ejs:github",
    `-o "${audioPath}"`,
  ];

  if (config.ytCookiesPath) {
    parts.splice(3, 0, `--cookies "${config.ytCookiesPath}"`);
  }

  parts.push(`"https://www.youtube.com/watch?v=${videoId}"`);
  return parts.join(" ");
}

async function checkPotProvider(): Promise<boolean> {
  try {
    const resp = await fetch(`${config.potProviderUrl}/ping`, {
      signal: AbortSignal.timeout(2000),
    });
    return resp.ok;
  } catch {
    return false;
  }
}

export function startWorker(): void {
  const connection = parseRedisUrl(config.redisUrl);

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
        const { existsSync, mkdirSync, readFileSync, unlinkSync } = await import("fs");

        if (!existsSync(config.downloadDir)) {
          mkdirSync(config.downloadDir, { recursive: true });
        }

        const potAvailable = await checkPotProvider();
        if (potAvailable) {
          console.log(`  PO Token provider disponible sur ${config.potProviderUrl}`);
        }

        const cmd = buildYtDlpCommand(videoId, audioPath);
        console.log(`  Commande: ${cmd}`);

        try {
          execSync(cmd, {
            timeout: 600000,
            env: {
              ...process.env,
              GETPOT_BGUTIL_BASEURL: potAvailable ? config.potProviderUrl : "",
            },
          });
        } catch (dlErr) {
          const errorMsg = dlErr instanceof Error ? dlErr.message : String(dlErr);
          console.error(`  yt-dlp erreur: ${errorMsg.substring(0, 300)}`);
          throw new Error(`Échec du téléchargement audio pour ${videoId}`);
        }

        if (!existsSync(audioPath)) {
          throw new Error(`Fichier audio non trouvé: ${audioPath}`);
        }

        console.log(`  Audio téléchargé: ${audioPath}`);

        const formData = new FormData();
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

        try { unlinkSync(audioPath); } catch { /* nettoyage optionnel */ }

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
    { connection, concurrency: 1, lockDuration: 600000, lockRenewTime: 30000 }
  );

  worker.on("failed", (job, err) => {
    console.error(`Job ${job?.id} échoué:`, err.message);
  });

  worker.on("completed", (job) => {
    console.log(`Job ${job.id} terminé`);
  });
}
