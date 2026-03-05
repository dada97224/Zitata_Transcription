import { Worker } from "bullmq";
import { join } from "path";
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
    "--no-warnings",
    "-q",
    `-o "${audioPath.replace(/"/g, '\\"')}"`,
  ];

  // En Docker il n’y a pas de navigateur : n’utiliser les cookies que si un fichier est fourni
  if (config.ytCookiesPath) {
    parts.splice(4, 0, `--cookies "${config.ytCookiesPath.replace(/"/g, '\\"')}"`);
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

/** Attend que l'ASR réponde à /health (modèle chargé) avant d'envoyer un gros fichier. */
async function waitForAsrReady(maxWaitMs: number = 600000): Promise<void> {
  const step = 5000;
  const start = Date.now();
  let lastErr: string | null = null;
  while (Date.now() - start < maxWaitMs) {
    try {
      const resp = await fetch(`${config.asrUrl}/health`, {
        signal: AbortSignal.timeout(5000),
      });
      if (resp.ok) {
        console.log(`  ASR prêt (${config.asrUrl}/health)`);
        return;
      }
      lastErr = `HTTP ${resp.status}`;
    } catch (e) {
      const err = e as Error & { cause?: Error; code?: string };
      lastErr = err.cause?.message ?? err.message ?? String(e);
      if (err.code) lastErr = `[${err.code}] ${lastErr}`;
    }
    const elapsed = Math.round((Date.now() - start) / 1000);
    console.log(`  En attente que l'ASR soit prêt (${elapsed}s)...`);
    await new Promise((r) => setTimeout(r, step));
  }
  const msg = lastErr ? ` Dernière erreur: ${lastErr}` : "";
  throw new Error("ASR non disponible après " + maxWaitMs / 1000 + " s (vérifier les logs du conteneur asr)." + msg);
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
      console.log(`Transcription démarrée pour ${videoId} (emissionId=${emissionId})`);

      try {
        const { execSync } = await import("child_process");
        const { existsSync, mkdirSync, readFileSync, unlinkSync } = await import("fs");

        const audioPath = join(config.downloadDir, `${videoId}.mp3`);
        if (!existsSync(config.downloadDir)) {
          mkdirSync(config.downloadDir, { recursive: true });
        }

        const potAvailable = await checkPotProvider();
        if (potAvailable) {
          console.log(`  PO Token provider disponible sur ${config.potProviderUrl}`);
        } else {
          console.log(`  PO Token provider non disponible, yt-dlp sans PO`);
        }
        if (!config.ytCookiesPath) {
          console.log(`  Aucun fichier de cookies YouTube (YT_COOKIES_PATH) — certains téléchargements peuvent échouer`);
        }

        const cmd = buildYtDlpCommand(videoId, audioPath);
        console.log(`  Téléchargement audio vers: ${audioPath}`);

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
          console.error(`  yt-dlp erreur: ${errorMsg.substring(0, 500)}`);
          throw new Error(`Échec du téléchargement audio pour ${videoId}: ${errorMsg.substring(0, 200)}`);
        }

        if (!existsSync(audioPath)) {
          throw new Error(`Fichier audio non trouvé après yt-dlp: ${audioPath}`);
        }

        console.log(`  Audio téléchargé (${audioPath}), envoi à l'ASR: ${config.asrUrl}/transcribe`);

        await waitForAsrReady(600000); // jusqu'à 10 min (chargement Parakeet peut être long)

        const audioBuffer = readFileSync(audioPath);
        const ASR_TIMEOUT_MS = 60 * 60 * 1000; // 60 min
        const ASR_MAX_RETRIES = 2;
        let response: Response | null = null;
        let lastErr: unknown;
        let formData = new FormData();
        formData.append("file", new Blob([audioBuffer], { type: "audio/mpeg" }), `${videoId}.mp3`);

        for (let attempt = 1; attempt <= ASR_MAX_RETRIES; attempt++) {
          try {
            console.log(`  En attente réponse ASR (tentative ${attempt}/${ASR_MAX_RETRIES}, jusqu'à ${ASR_TIMEOUT_MS / 60000} min)...`);
            response = await fetch(`${config.asrUrl}/transcribe`, {
              method: "POST",
              body: formData,
              signal: AbortSignal.timeout(ASR_TIMEOUT_MS),
            });
            lastErr = null;
            break;
          } catch (fetchErr) {
            lastErr = fetchErr;
            const err = fetchErr as Error & { cause?: Error & { code?: string }; code?: string };
            const code = err.code ?? err.cause?.code;
            console.error(`  ASR fetch tentative ${attempt} échouée:`, err.message, code ? `[${code}]` : "", err.cause ? `(cause: ${err.cause.message})` : "");
            if (attempt < ASR_MAX_RETRIES) {
              console.log(`  Nouvelle tentative dans 10 s...`);
              await new Promise((r) => setTimeout(r, 10000));
              formData = new FormData();
              formData.append("file", new Blob([audioBuffer], { type: "audio/mpeg" }), `${videoId}.mp3`);
            }
          }
        }
        if (lastErr) throw lastErr;
        if (!response) throw new Error("Aucune réponse ASR");

        const responseText = await response.text();
        if (!response.ok) {
          console.error(`  ASR erreur ${response.status}: ${responseText.substring(0, 400)}`);
          throw new Error(`ASR répondu ${response.status}: ${responseText.substring(0, 150)}`);
        }

        let data: { segments?: Array<{ start: number; end: number; text: string }> };
        try {
          data = JSON.parse(responseText) as { segments?: Array<{ start: number; end: number; text: string }> };
        } catch (parseErr) {
          console.error(`  ASR réponse JSON invalide: ${responseText.substring(0, 300)}`);
          throw new Error("Réponse ASR invalide (JSON attendu)");
        }

        const segments = data?.segments;
        if (!Array.isArray(segments)) {
          console.error(`  ASR n'a pas renvoyé segments (keys: ${data ? Object.keys(data).join(",") : "null"})`);
          throw new Error("Réponse ASR sans tableau segments");
        }

        for (let i = 0; i < segments.length; i++) {
          const seg = segments[i];
          await pool.query(
            `INSERT INTO segments (emission_id, segment_number, start_sec, end_sec, texte)
             VALUES ($1, $2, $3, $4, $5)`,
            [emissionId, i + 1, seg.start, seg.end, seg.text ?? ""]
          );
        }

        await pool.query(
          "UPDATE emissions SET status_transcription = 'done', updated_at = NOW() WHERE id = $1",
          [emissionId]
        );

        try { unlinkSync(audioPath); } catch { /* nettoyage optionnel */ }

        console.log(
          `Transcription terminée pour ${videoId}: ${segments.length} segments`
        );
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        const errStack = err instanceof Error ? err.stack : "";
        console.error(`  [ERREUR transcription ${videoId}]`, errMsg);
        if (errStack) console.error(errStack);
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
