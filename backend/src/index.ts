import express from "express";
import cors from "cors";
import { config } from "./config";
import { initDb } from "./db";
import { youtubeRouter } from "./routes/youtube";
import { rechercheRouter } from "./routes/recherche";
import { healthRouter } from "./routes/health";
import { startWorker } from "./workers/transcribe";

const app = express();

app.use(cors());
app.use(express.json());

app.use("/health", healthRouter);
app.use("/youtube", youtubeRouter);
app.use("/recherche", rechercheRouter);

async function start(): Promise<void> {
  try {
    await initDb();
    console.log("✓ Base de données initialisée");

    startWorker();
    console.log("✓ Worker de transcription démarré");

    app.listen(config.port, () => {
      console.log(`✓ Backend API sur http://localhost:${config.port}`);
    });
  } catch (err) {
    console.error("Erreur au démarrage:", err);
    process.exit(1);
  }
}

start();
