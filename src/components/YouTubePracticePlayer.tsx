import { useEffect, useRef, useState } from 'react';
import YouTube, { type YouTubePlayer } from 'react-youtube';
import { shouldLoop, type PracticeRange } from '../domain/practiceRange';

type YouTubePracticePlayerProps = {
  youtubeUrl: string;
  range: PracticeRange | null;
  looping: boolean;
  onCurrentTime(seconds: number): void;
};

function getVideoId(url: string): string | null {
  try {
    const parsed = new URL(url);
    if (parsed.hostname === 'youtu.be') return parsed.pathname.slice(1) || null;
    if (parsed.hostname.endsWith('youtube.com')) return parsed.searchParams.get('v') ?? parsed.pathname.split('/embed/')[1] ?? null;
  } catch { return null; }
  return null;
}

export function YouTubePracticePlayer({ youtubeUrl, range, looping, onCurrentTime }: YouTubePracticePlayerProps) {
  const playerRef = useRef<YouTubePlayer | null>(null);
  const [error, setError] = useState<string | null>(null);
  const videoId = getVideoId(youtubeUrl);

  useEffect(() => {
    if (playerRef.current && range) {
      void playerRef.current.seekTo(range.startSeconds, true);
      void playerRef.current.playVideo();
    }
  }, [range]);

  useEffect(() => {
    if (!looping || !range || !playerRef.current) return;
    const timer = window.setInterval(async () => {
      const player = playerRef.current;
      if (!player) return;
      const currentTime = await player.getCurrentTime();
      onCurrentTime(currentTime);
      if (shouldLoop(currentTime, range)) {
        await player.seekTo(range.startSeconds, true);
        await player.playVideo();
      }
    }, 100);
    return () => window.clearInterval(timer);
  }, [looping, onCurrentTime, range]);

  if (!videoId) return <p role="alert">This YouTube link cannot be embedded.</p>;

  return <>
    {error && <p role="alert">{error}</p>}
    <YouTube
      videoId={videoId}
      opts={{ playerVars: { rel: 0 } }}
      onReady={(event) => { playerRef.current = event.target; }}
      onError={() => setError('This YouTube video cannot be embedded.')}
    />
  </>;
}
