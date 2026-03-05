"use client";

import { VideoCard } from "./VideoCard";

interface SearchResult {
  emission: {
    id: number;
    youtube_video_id: string;
    titre: string;
    date_diffusion: string;
    thumbnail_url: string;
    duree_sec: number;
  };
  segment: {
    id: number;
    segment_number: number;
    start_sec: number;
    end_sec: number;
    texte_extrait: string;
    score: number;
  };
}

interface VideoGridProps {
  results: SearchResult[];
  onPlaySegment: (videoId: string, startSec: number, titre: string) => void;
}

export function VideoGrid({ results, onPlaySegment }: VideoGridProps) {
  if (results.length === 0) return null;

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
      {results.map((r) => (
        <VideoCard
          key={`${r.emission.youtube_video_id}-${r.segment.id}`}
          videoId={r.emission.youtube_video_id}
          titre={r.emission.titre}
          dateDiffusion={r.emission.date_diffusion}
          thumbnailUrl={r.emission.thumbnail_url}
          startSec={r.segment.start_sec}
          texteExtrait={r.segment.texte_extrait}
          score={r.segment.score}
          onPlay={() =>
            onPlaySegment(
              r.emission.youtube_video_id,
              r.segment.start_sec,
              r.emission.titre
            )
          }
        />
      ))}
    </div>
  );
}
