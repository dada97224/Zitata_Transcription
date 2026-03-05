import { Router } from "express";
import { pool } from "../db";
import { config } from "../config";

const router = Router();

router.get("/", async (_req, res) => {
  try {
    const dbResult = await pool.query("SELECT NOW()");
    res.json({
      status: "ok",
      timestamp: dbResult.rows[0].now,
      service: "zitata-backend",
    });
  } catch {
    res.status(503).json({ status: "error", message: "Database unreachable" });
  }
});

/** Vérifie DB, Redis et ASR pour le debug (sans exposer de secrets). */
router.get("/diagnostics", async (_req, res) => {
  const diagnostics: Record<string, { ok: boolean; detail?: string }> = {};

  try {
    await pool.query("SELECT 1");
    const count = await pool.query(
      "SELECT (SELECT COUNT(*) FROM emissions) AS emissions, (SELECT COUNT(*) FROM segments) AS segments"
    );
    const { emissions, segments } = count.rows[0];
    diagnostics.database = { ok: true, detail: `${emissions} émissions, ${segments} segments` };
  } catch (e) {
    diagnostics.database = { ok: false, detail: e instanceof Error ? e.message : String(e) };
  }

  try {
    const { Queue } = await import("bullmq");
    const { host, port } = new URL(config.redisUrl);
    const q = new Queue("transcribe-youtube", {
      connection: { host: host || "localhost", port: parseInt(port || "6379") },
    });
    const waiting = await q.getWaitingCount();
    const active = await q.getActiveCount();
    await q.close();
    diagnostics.redis = { ok: true, detail: `file d'attente: ${waiting} en attente, ${active} en cours` };
  } catch (e) {
    diagnostics.redis = { ok: false, detail: e instanceof Error ? e.message : String(e) };
  }

  try {
    const r = await fetch(`${config.asrUrl}/health`, { signal: AbortSignal.timeout(3000) });
    const body = (await r.json()) as { status?: string; mode?: string };
    diagnostics.asr = r.ok
      ? { ok: true, detail: `mode=${body.mode ?? "?"}` }
      : { ok: false, detail: `HTTP ${r.status}` };
  } catch (e) {
    diagnostics.asr = { ok: false, detail: e instanceof Error ? e.message : String(e) };
  }

  const allOk = Object.values(diagnostics).every((d) => d.ok);
  res.status(allOk ? 200 : 503).json({ status: allOk ? "ok" : "degraded", diagnostics });
});

export const healthRouter = router;
