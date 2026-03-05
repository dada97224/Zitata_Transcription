import { Router, Request, Response } from "express";
import { pool } from "../db";

const router = Router();

router.get("/", async (req: Request, res: Response) => {
  const q = (req.query.q as string) || "";
  const limit = Math.min(parseInt((req.query.limit as string) || "20"), 100);

  if (!q.trim()) {
    res.json([]);
    return;
  }

  try {
    const { rows } = await pool.query(
      `SELECT
        e.id AS emission_id,
        e.youtube_video_id,
        e.titre,
        e.date_diffusion,
        e.thumbnail_url,
        e.duree_sec,
        s.id AS segment_id,
        s.segment_number,
        s.start_sec,
        s.end_sec,
        s.texte,
        COALESCE(ts_rank(s.texte_fts, plainto_tsquery('french', unaccent($1))), 0) AS score
      FROM segments s
      JOIN emissions e ON e.id = s.emission_id
      WHERE s.texte_fts @@ plainto_tsquery('french', unaccent($1))
         OR s.texte ILIKE '%' || $1 || '%'
      ORDER BY score DESC, s.start_sec ASC
      LIMIT $2`,
      [q, limit]
    );

    const results = rows.map((row) => ({
      emission: {
        id: row.emission_id,
        youtube_video_id: row.youtube_video_id,
        titre: row.titre,
        date_diffusion: row.date_diffusion,
        thumbnail_url: row.thumbnail_url,
        duree_sec: row.duree_sec,
      },
      segment: {
        id: row.segment_id,
        segment_number: row.segment_number,
        start_sec: row.start_sec,
        end_sec: row.end_sec,
        texte_extrait: row.texte,
        score: parseFloat(row.score),
      },
    }));

    res.json(results);
  } catch (err) {
    console.error("Erreur recherche:", err);
    res.status(500).json({ error: "Erreur lors de la recherche" });
  }
});

export const rechercheRouter = router;
