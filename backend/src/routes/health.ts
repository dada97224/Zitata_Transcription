import { Router } from "express";
import { pool } from "../db";

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

export const healthRouter = router;
