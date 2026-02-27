"use client";

import YouTube, { YouTubeEvent } from "react-youtube";
import { useCallback } from "react";

interface YouTubePlayerProps {
  videoId: string;
  startSeconds: number;
}

export function YouTubePlayer({ videoId, startSeconds }: YouTubePlayerProps) {
  const onReady = useCallback(
    (event: YouTubeEvent) => {
      event.target.seekTo(startSeconds, true);
      event.target.playVideo();
    },
    [startSeconds]
  );

  return (
    <div className="aspect-video w-full max-w-4xl mx-auto rounded-lg overflow-hidden shadow-lg">
      <YouTube
        videoId={videoId}
        opts={{
          width: "100%",
          height: "100%",
          playerVars: {
            autoplay: 1,
            start: Math.floor(startSeconds),
            rel: 0,
          },
        }}
        onReady={onReady}
        className="w-full h-full"
        iframeClassName="w-full h-full"
      />
    </div>
  );
}
