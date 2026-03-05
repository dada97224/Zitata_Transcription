"use client";

interface VideoCardProps {
  videoId: string;
  titre: string;
  dateDiffusion: string;
  thumbnailUrl: string;
  startSec: number;
  texteExtrait: string;
  score: number;
  onPlay: () => void;
}

function formatTimecode(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  return `${h.toString().padStart(2, "0")}:${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
}

function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString("fr-FR", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

export function VideoCard({
  titre,
  dateDiffusion,
  thumbnailUrl,
  startSec,
  texteExtrait,
  onPlay,
}: VideoCardProps) {
  return (
    <div className="bg-white rounded-lg shadow-sm border hover:shadow-md transition-shadow overflow-hidden">
      <div className="relative cursor-pointer group" onClick={onPlay}>
        <img
          src={thumbnailUrl}
          alt={titre}
          className="w-full h-40 object-cover"
        />
        <div className="absolute inset-0 bg-black bg-opacity-0 group-hover:bg-opacity-30 transition-all flex items-center justify-center">
          <span className="opacity-0 group-hover:opacity-100 text-white text-5xl transition-opacity">
            ▶
          </span>
        </div>
      </div>
      <div className="p-4">
        <h3 className="font-semibold text-gray-800 text-sm line-clamp-2 mb-1">
          {titre}
        </h3>
        <p className="text-xs text-gray-400 mb-2">{formatDate(dateDiffusion)}</p>
        <button
          onClick={onPlay}
          className="inline-flex items-center gap-1 text-blue-600 hover:text-blue-800 text-sm font-medium mb-2"
        >
          ▶ {formatTimecode(startSec)}
        </button>
        <p className="text-xs text-gray-500 line-clamp-3">&quot;{texteExtrait}&quot;</p>
      </div>
    </div>
  );
}
