import { useEffect, useRef, useState } from 'react';
import examples from '../../../public/assets/prompt-videos-v1/manifest.json';

type VideoExample = (typeof examples.videos)[number];

export function PromptVideoArtwork({ video, large }: { video: VideoExample; large: boolean }) {
  const player = useRef<HTMLVideoElement>(null);
  const [failed, setFailed] = useState(false);
  const [posterFailed, setPosterFailed] = useState(false);
  useEffect(() => {
    const element = player.current;
    if (!large || !element) return;
    const pause = () => { if (document.hidden) element.pause(); };
    const leave = () => element.pause();
    document.addEventListener('visibilitychange', pause);
    window.addEventListener('pagehide', leave);
    return () => {
      element.pause();
      document.removeEventListener('visibilitychange', pause);
      window.removeEventListener('pagehide', leave);
    };
  }, [large, video.id]);
  return <div className={`ux-art ux-art-video ${large ? 'ux-art-large' : ''}`} data-evidence="public-ai-video" data-kind="video" data-video-id={video.id}>
    {large && !failed ? <video ref={player} controls muted playsInline preload="none" poster={video.poster}
      width={video.width} height={video.height} src={video.url} aria-label={`${video.title} 영상 예시`}
      onError={() => setFailed(true)} /> : <>
      {!posterFailed ? <img src={video.poster} width={video.width} height={video.height} loading={large ? 'eager' : 'lazy'} decoding="async"
        alt={`${video.title} · 공개 AI 영상의 정지 썸네일`} onError={() => setPosterFailed(true)} />
        : <span className="ux-art-video-placeholder" role="img" aria-label="영상 썸네일을 불러오지 못했어요">영상 예시</span>}
      {!large && <span className="ux-art-play" aria-hidden="true">▷</span>}
    </>}
    {failed && <p className="ux-art-video-error" role="status">영상을 재생할 수 없어요.</p>}
    {!large && <span className="ux-art-evidence">AI 영상 · {Math.round(video.duration)}초</span>}
  </div>;
}
