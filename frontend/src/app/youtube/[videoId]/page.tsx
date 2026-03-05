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

const SLICE_DURATION_SEC = 30;

function formatTimecode(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  return `${h.toString().padStart(2, "0")}:${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
}

/**
 * Répartit les segments en tranches fixes de 30 s sans duplication :
 * le texte d'un segment long est découpé par mots et attribué aux tranches
 * qu'il couvre, au prorata du temps (évite répétitions et "trous" au milieu d'un segment).
 */
function segmentsToSlices(
  segments: Segment[],
  durationSec: number
): { startSec: number; endSec: number; text: string }[] {
  const slices: { startSec: number; endSec: number; text: string }[] = [];
  for (let t = 0; t < durationSec; t += SLICE_DURATION_SEC) {
    slices.push({
      startSec: t,
      endSec: Math.min(t + SLICE_DURATION_SEC, durationSec),
      text: "",
    });
  }
  const sliceTexts: string[][] = slices.map(() => []);

  for (const seg of segments.sort((a, b) => a.start_sec - b.start_sec)) {
    const segDur = seg.end_sec - seg.start_sec;
    if (segDur <= 0 || !seg.texte.trim()) continue;

    const words = seg.texte.trim().split(/\s+/).filter(Boolean);
    if (words.length === 0) continue;

    // Tranches que ce segment chevauche, avec durée d'overlap
    const parts: { sliceIndex: number; duration: number }[] = [];
    for (let i = 0; i < slices.length; i++) {
      const sl = slices[i];
      const overlapStart = Math.max(seg.start_sec, sl.startSec);
      const overlapEnd = Math.min(seg.end_sec, sl.endSec);
      const duration = Math.max(0, overlapEnd - overlapStart);
      if (duration > 0) parts.push({ sliceIndex: i, duration });
    }

    const totalOverlap = parts.reduce((s, p) => s + p.duration, 0);
    if (totalOverlap <= 0) continue;

    // Répartition des mots au prorata du temps (chaque mot dans une seule tranche)
    let wordIdx = 0;
    for (const { sliceIndex, duration } of parts) {
      const ratio = duration / totalOverlap;
      const numWords = Math.max(0, Math.round(ratio * words.length));
      const chunk = words.slice(wordIdx, wordIdx + numWords);
      wordIdx += numWords;
      if (chunk.length) sliceTexts[sliceIndex].push(chunk.join(" "));
    }
    // Reste éventuel (arrondi) → dernière tranche du segment
    if (wordIdx < words.length && parts.length) {
      const lastIdx = parts[parts.length - 1].sliceIndex;
      sliceTexts[lastIdx].push(words.slice(wordIdx).join(" "));
    }
  }

  return slices.map((sl, i) => ({
    ...sl,
    text: sliceTexts[i].join(" ").trim(),
  }));
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
          Transcription par tranches de 30 s
        </h2>
        {(() => {
          // Durée : emission.duree_sec si dispo, sinon déduite du dernier segment (évite "durée inconnue")
          const fromSegments =
            segments.length > 0
              ? Math.ceil(
                  Math.max(...segments.map((s) => s.end_sec))
                )
              : 0;
          const durationSec =
            emission.duree_sec && emission.duree_sec > 0
              ? emission.duree_sec
              : fromSegments;
          const slices = segmentsToSlices(segments, durationSec);
          if (slices.length === 0) {
            return (
              <p className="text-gray-500">
                Aucune tranche (aucun segment et durée vidéo inconnue)
              </p>
            );
          }
          return (
            <div className="space-y-3">
              {slices.map((slice, i) => (
                <div
                  key={i}
                  className="flex gap-3 p-3 bg-white rounded-lg border hover:bg-blue-50 cursor-pointer transition-colors"
                  onClick={() => setStartSec(slice.startSec)}
                >
                  <button
                    className="text-blue-600 font-mono text-sm whitespace-nowrap hover:text-blue-800"
                    title={`Lancer la lecture à ${formatTimecode(slice.startSec)}`}
                  >
                    ▶ {formatTimecode(slice.startSec)} –{" "}
                    {formatTimecode(slice.endSec)}
                  </button>
                  <p className="text-sm text-gray-700 flex-1">
                    {slice.text || (
                      <span className="text-gray-400 italic">
                        (aucune transcription pour cette tranche)
                      </span>
                    )}
                  </p>
                </div>
              ))}
            </div>
          );
        })()}
      </div>
    </div>
  );
}
