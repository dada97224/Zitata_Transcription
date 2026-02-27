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

router.post("/seed", async (_req: Request, res: Response) => {
  try {
    const mockEmissions = [
      {
        videoId: "dQw4w9WgXcQ",
        titre: "Émission 1523 - Ouragan et catastrophes naturelles",
        date: "2026-02-15T20:00:00Z",
        duree: 3600,
      },
      {
        videoId: "jNQXAC9IVRw",
        titre: "Émission 1478 - Économie mondiale et marchés",
        date: "2026-01-03T20:00:00Z",
        duree: 3600,
      },
      {
        videoId: "9bZkp7q19f0",
        titre: "Émission 1500 - Technologies et intelligence artificielle",
        date: "2026-01-20T20:00:00Z",
        duree: 3600,
      },
      {
        videoId: "kJQP7kiw5Fk",
        titre: "Émission 1510 - Politique internationale",
        date: "2026-02-01T20:00:00Z",
        duree: 3600,
      },
      {
        videoId: "RgKAFK5djSk",
        titre: "Émission 1520 - Environnement et climat",
        date: "2026-02-10T20:00:00Z",
        duree: 3600,
      },
    ];

    const mockSegments: Record<string, Array<{ start: number; end: number; texte: string }>> = {
      dQw4w9WgXcQ: [
        { start: 0, end: 120, texte: "Bonsoir et bienvenue dans notre émission spéciale sur les catastrophes naturelles. Ce soir nous allons parler des ouragans qui ont frappé les côtes atlantiques cette année." },
        { start: 120, end: 300, texte: "Un ouragan de catégorie quatre a touché la Floride la semaine dernière, causant des dégâts considérables. Les vents ont atteint deux cents kilomètres heure." },
        { start: 300, end: 500, texte: "Les services météorologiques avaient lancé une alerte ouragan quarante-huit heures avant l'arrivée du phénomène. L'évacuation des populations côtières a été organisée en urgence." },
        { start: 500, end: 700, texte: "L'impact économique de cet ouragan est estimé à plusieurs milliards de dollars. Les infrastructures routières et les réseaux électriques ont été fortement endommagés." },
        { start: 700, end: 900, texte: "Le changement climatique intensifie la fréquence et la puissance des ouragans selon les dernières études scientifiques. La température des océans en est la cause principale." },
        { start: 1395, end: 1600, texte: "En conclusion, la prévention et la préparation restent les meilleurs outils face aux ouragans. Les systèmes d'alerte précoce sauvent des milliers de vies chaque année." },
      ],
      jNQXAC9IVRw: [
        { start: 0, end: 180, texte: "Bonsoir, ce soir nous analysons la situation économique mondiale. Les marchés financiers ont connu une semaine mouvementée avec une forte volatilité." },
        { start: 180, end: 400, texte: "La Banque centrale européenne a maintenu ses taux directeurs. L'inflation dans la zone euro reste au-dessus de l'objectif de deux pour cent." },
        { start: 400, end: 600, texte: "Le marché de l'emploi en France montre des signes de reprise. Le taux de chômage a légèrement baissé au dernier trimestre." },
        { start: 600, end: 800, texte: "L'impact économique de l'ouragan sur les marchés américains a été significatif. Les compagnies d'assurance ont vu leurs actions chuter." },
        { start: 2700, end: 2900, texte: "Les nouvelles technologies transforment profondément l'économie mondiale. L'intelligence artificielle crée de nouveaux secteurs d'activité tout en en supprimant d'autres." },
      ],
      "9bZkp7q19f0": [
        { start: 0, end: 200, texte: "Ce soir dans notre émission technologie, nous explorons les dernières avancées en intelligence artificielle. Les modèles de langage deviennent de plus en plus performants." },
        { start: 200, end: 450, texte: "La reconnaissance vocale a fait des progrès spectaculaires. Les systèmes de transcription automatique atteignent maintenant une précision de quatre-vingt-dix-huit pour cent." },
        { start: 450, end: 700, texte: "Les véhicules autonomes continuent leur développement. Plusieurs villes européennes testent des navettes sans conducteur dans leurs centres-villes." },
        { start: 700, end: 950, texte: "La cybersécurité reste un enjeu majeur pour les entreprises. Les attaques par rançongiciel ont augmenté de cinquante pour cent cette année." },
        { start: 950, end: 1200, texte: "L'informatique quantique pourrait révolutionner le calcul scientifique. Les premiers ordinateurs quantiques commerciaux sont attendus dans les prochaines années." },
      ],
      kJQP7kiw5Fk: [
        { start: 0, end: 150, texte: "Bonsoir, nous commençons ce journal par la situation politique internationale. Les tensions géopolitiques restent élevées dans plusieurs régions du monde." },
        { start: 150, end: 400, texte: "Les élections régionales en Europe ont montré une progression des partis écologistes. L'environnement devient un thème central du débat politique." },
        { start: 400, end: 650, texte: "Le sommet du G20 a débouché sur un accord sur la taxation minimale des multinationales. Cette mesure pourrait rapporter des milliards d'euros aux États." },
        { start: 650, end: 900, texte: "La politique migratoire divise toujours l'Union européenne. Les pays membres peinent à trouver un consensus sur la répartition des demandeurs d'asile." },
      ],
      RgKAFK5djSk: [
        { start: 0, end: 200, texte: "Ce soir nous parlons d'environnement et de changement climatique. Les émissions de gaz à effet de serre continuent d'augmenter malgré les engagements internationaux." },
        { start: 200, end: 450, texte: "La déforestation de l'Amazonie a atteint un nouveau record cette année. Les scientifiques alertent sur les conséquences irréversibles pour la biodiversité." },
        { start: 450, end: 700, texte: "Les énergies renouvelables progressent rapidement. Le solaire et l'éolien représentent maintenant trente pour cent de la production électrique en Europe." },
        { start: 700, end: 950, texte: "La pollution plastique des océans est devenue un problème mondial. Huit millions de tonnes de plastique finissent dans les mers chaque année." },
        { start: 950, end: 1200, texte: "L'ouragan récent rappelle l'urgence climatique. Les événements météorologiques extrêmes sont de plus en plus fréquents et de plus en plus violents." },
      ],
    };

    let emissionsInserted = 0;
    let segmentsInserted = 0;

    for (const em of mockEmissions) {
      const result = await pool.query(
        `INSERT INTO emissions (youtube_video_id, titre, date_diffusion, duree_sec, youtube_url, thumbnail_url, status_transcription)
         VALUES ($1, $2, $3, $4, $5, $6, 'done')
         ON CONFLICT (youtube_video_id) DO NOTHING
         RETURNING id`,
        [
          em.videoId,
          em.titre,
          em.date,
          em.duree,
          `https://www.youtube.com/watch?v=${em.videoId}`,
          `https://img.youtube.com/vi/${em.videoId}/mqdefault.jpg`,
        ]
      );

      if (result.rows.length > 0) {
        const emissionId = result.rows[0].id;
        emissionsInserted++;

        const segs = mockSegments[em.videoId] || [];
        for (let i = 0; i < segs.length; i++) {
          await pool.query(
            `INSERT INTO segments (emission_id, segment_number, start_sec, end_sec, texte)
             VALUES ($1, $2, $3, $4, $5)`,
            [emissionId, i + 1, segs[i].start, segs[i].end, segs[i].texte]
          );
          segmentsInserted++;
        }
      }
    }

    res.json({
      message: `Seed terminé: ${emissionsInserted} émissions, ${segmentsInserted} segments`,
      emissionsInserted,
      segmentsInserted,
    });
  } catch (err) {
    console.error("Erreur seed:", err);
    res.status(500).json({ error: "Erreur lors du seed" });
  }
});

export const youtubeRouter = router;
