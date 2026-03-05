"use client";

import { useState, useEffect } from "react";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001";

interface Emission {
  id: number;
  youtube_video_id: string;
  titre: string;
  date_diffusion: string;
  duree_sec: number;
  thumbnail_url: string;
  status_transcription: string;
}

const statusColors: Record<string, string> = {
  pending: "bg-yellow-100 text-yellow-800",
  processing: "bg-blue-100 text-blue-800",
  done: "bg-green-100 text-green-800",
  error: "bg-red-100 text-red-800",
};

export default function YouTubePage() {
  const [videos, setVideos] = useState<Emission[]>([]);
  const [loading, setLoading] = useState(true);
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);

  const fetchVideos = () => {
    fetch(`${API_URL}/youtube/videos`)
      .then((r) => r.json())
      .then((data) => setVideos(Array.isArray(data) ? data : []))
      .catch(() => setVideos([]))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    fetchVideos();
  }, []);

  const handleImportChannel = async () => {
    setImporting(true);
    setImportError(null);
    try {
      const res = await fetch(`${API_URL}/youtube/import-channel`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Import échoué");
      setLoading(true);
      fetchVideos();
    } catch (err) {
      setImportError(err instanceof Error ? err.message : "Erreur inconnue");
    } finally {
      setImporting(false);
    }
  };

  const handleTranscribe = async (videoId: string) => {
    try {
      await fetch(`${API_URL}/youtube/${videoId}/transcribe`, {
        method: "POST",
      });
      setVideos((prev) =>
        prev.map((v) =>
          v.youtube_video_id === videoId
            ? { ...v, status_transcription: "processing" }
            : v
        )
      );
    } catch (err) {
      console.error("Erreur:", err);
    }
  };

  if (loading) {
    return (
      <div className="flex justify-center py-20">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" />
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-gray-800">
          Vidéos YouTube ({videos.length})
        </h1>
        <button
          onClick={handleImportChannel}
          disabled={importing}
          className="px-3 py-1.5 text-sm bg-gray-200 text-gray-800 rounded-lg hover:bg-gray-300 disabled:opacity-50"
        >
          {importing ? "Import…" : "Importer ma chaîne"}
        </button>
      </div>
      {importError && (
        <p className="mb-4 text-sm text-red-600">{importError}</p>
      )}

      {videos.length === 0 ? (
        <div className="text-center py-20 text-gray-500">
          <p className="text-lg mb-2">Aucune vidéo importée</p>
          <p className="text-sm mb-4">
            Importez les vidéos de votre chaîne YouTube (clés API dans .env)
          </p>
          <button
            onClick={handleImportChannel}
            disabled={importing}
            className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
          >
            {importing ? "Import en cours…" : "Importer ma chaîne YouTube"}
          </button>
          {importError && (
            <p className="mt-3 text-sm text-red-600">{importError}</p>
          )}
        </div>
      ) : (
        <div className="space-y-3">
          {videos.map((v) => (
            <div
              key={v.id}
              className="flex items-center gap-4 bg-white rounded-lg shadow-sm border p-3 hover:shadow-md transition-shadow"
            >
              <a href={`/youtube/${v.youtube_video_id}`}>
                <img
                  src={v.thumbnail_url}
                  alt={v.titre}
                  className="w-32 h-20 object-cover rounded"
                />
              </a>
              <div className="flex-1 min-w-0">
                <a
                  href={`/youtube/${v.youtube_video_id}`}
                  className="font-medium text-gray-800 hover:text-blue-600 block truncate"
                >
                  {v.titre}
                </a>
                <p className="text-sm text-gray-400">
                  {new Date(v.date_diffusion).toLocaleDateString("fr-FR")}
                  {v.duree_sec
                    ? ` · ${Math.floor(v.duree_sec / 60)} min`
                    : ""}
                </p>
              </div>
              <span
                className={`px-2 py-1 rounded-full text-xs font-medium ${statusColors[v.status_transcription] || "bg-gray-100"}`}
              >
                {v.status_transcription}
              </span>
              {v.status_transcription === "pending" && (
                <button
                  onClick={() => handleTranscribe(v.youtube_video_id)}
                  className="px-3 py-1 bg-blue-600 text-white rounded text-sm hover:bg-blue-700"
                >
                  Transcrire
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
