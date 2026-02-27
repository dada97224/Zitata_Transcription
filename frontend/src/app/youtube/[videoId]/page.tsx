"use client";

import { useState, useEffect } from "react";
import { useParams } from "next/navigation";
import { YouTubePlayer } from "../../components/YouTubePlayer";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001";

interface Emission {
  id: number;
  youtube_video_id: string;
  titre: string;
  date_diffusion: string;
  duree_sec: number;
  status_transcription: string;
}

interface Segment {
  id: number;
  segment_number: number;
  start_sec: number;
  end_sec: number;
  texte: string;
}

function formatTimecode(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  return `${h.toString().padStart(2, "0")}:${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
}

export default function VideoDetailPage() {
  const params = useParams();
  const videoId = params.videoId as string;
  const [emission, setEmission] = useState<Emission | null>(null);
  const [segments, setSegments] = useState<Segment[]>([]);
  const [startSec, setStartSec] = useState(0);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(`${API_URL}/youtube/${videoId}`)
      .then((r) => r.json())
      .then((data) => {
        setEmission(data.emission);
        setSegments(data.segments || []);
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [videoId]);

  if (loading) {
    return (
      <div className="flex justify-center py-20">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" />
      </div>
    );
  }

  if (!emission) {
    return (
      <div className="text-center py-20 text-gray-500">Vidéo non trouvée</div>
    );
  }

  return (
    <div>
      <h1 className="text-2xl font-bold text-gray-800 mb-4">
        {emission.titre}
      </h1>
      <p className="text-gray-400 mb-6">
        {new Date(emission.date_diffusion).toLocaleDateString("fr-FR", {
          weekday: "long",
          year: "numeric",
          month: "long",
          day: "numeric",
        })}
      </p>

      <YouTubePlayer videoId={videoId} startSeconds={startSec} />

      <div className="mt-8">
        <h2 className="text-lg font-semibold text-gray-700 mb-4">
          Segments ({segments.length})
        </h2>
        {segments.length === 0 ? (
          <p className="text-gray-500">Aucun segment transcrit</p>
        ) : (
          <div className="space-y-2">
            {segments.map((seg) => (
              <div
                key={seg.id}
                className="flex gap-3 p-3 bg-white rounded-lg border hover:bg-blue-50 cursor-pointer transition-colors"
                onClick={() => setStartSec(seg.start_sec)}
              >
                <button className="text-blue-600 font-mono text-sm whitespace-nowrap hover:text-blue-800">
                  ▶ {formatTimecode(seg.start_sec)}
                </button>
                <p className="text-sm text-gray-700">{seg.texte}</p>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
