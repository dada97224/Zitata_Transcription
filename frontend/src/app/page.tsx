"use client";

import { useState, FormEvent } from "react";
import { SearchBar } from "./components/SearchBar";
import { VideoGrid } from "./components/VideoGrid";
import { YouTubePlayer } from "./components/YouTubePlayer";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001";

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

export default function HomePage() {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [activeVideo, setActiveVideo] = useState<{
    videoId: string;
    startSec: number;
    titre: string;
  } | null>(null);

  const handleSearch = async (e: FormEvent) => {
    e.preventDefault();
    if (!query.trim()) return;

    setLoading(true);
    try {
      const res = await fetch(
        `${API_URL}/recherche?q=${encodeURIComponent(query)}&limit=20`
      );
      const data = await res.json();
      setResults(data);
    } catch (err) {
      console.error("Erreur recherche:", err);
    } finally {
      setLoading(false);
    }
  };

  const handlePlaySegment = (videoId: string, startSec: number, titre: string) => {
    setActiveVideo({ videoId, startSec, titre });
  };

  return (
    <div>
      <div className="text-center mb-8">
        <h1 className="text-3xl font-bold text-gray-800 mb-2">
          Recherche dans les émissions
        </h1>
        <p className="text-gray-500">
          Recherchez par sujets, noms ou mots-clés avec timecode précis
        </p>
      </div>

      <SearchBar
        query={query}
        onQueryChange={setQuery}
        onSearch={handleSearch}
        loading={loading}
      />

      {activeVideo && (
        <div className="mb-8">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-lg font-semibold text-gray-700">
              {activeVideo.titre}
            </h2>
            <button
              onClick={() => setActiveVideo(null)}
              className="text-gray-400 hover:text-gray-600 text-2xl"
            >
              ×
            </button>
          </div>
          <YouTubePlayer
            videoId={activeVideo.videoId}
            startSeconds={activeVideo.startSec}
          />
        </div>
      )}

      {results.length > 0 && (
        <div className="mb-4">
          <p className="text-sm text-gray-500">
            {results.length} résultat{results.length > 1 ? "s" : ""} pour &quot;{query}&quot;
          </p>
        </div>
      )}

      <VideoGrid results={results} onPlaySegment={handlePlaySegment} />
    </div>
  );
}
