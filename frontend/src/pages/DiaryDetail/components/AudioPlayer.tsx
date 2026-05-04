import { useEffect, useMemo, useRef } from "react";
import { TranscriptSegment } from "../types";
import { formatTime } from "../utils";
import { PauseIcon, PlayTriangleIcon } from "./icons";

interface AudioPlayerProps {
  audioUrl: string;
  duration: number;
  currentTime: number;
  isPlaying: boolean;
  seekTo: number | null;
  segments: TranscriptSegment[];
  onSeekHandled: () => void;
  onTogglePlay: () => void;
  onSeek: (seconds: number) => void;
  onTimeUpdate: (seconds: number) => void;
  onEnded: () => void;
}

export function AudioPlayer({
  audioUrl,
  duration,
  currentTime,
  isPlaying,
  seekTo,
  segments,
  onSeekHandled,
  onTogglePlay,
  onSeek,
  onTimeUpdate,
  onEnded,
}: AudioPlayerProps) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const progressPercent = Math.min(100, Math.max(0, (currentTime / duration) * 100));

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) {
      return;
    }
    if (isPlaying) {
      audio.play().catch(() => {
        onEnded();
      });
      return;
    }
    audio.pause();
  }, [isPlaying, onEnded]);

  useEffect(() => {
    if (seekTo === null) {
      return;
    }
    const audio = audioRef.current;
    if (!audio) {
      return;
    }
    audio.currentTime = Math.min(duration, Math.max(0, seekTo));
    onSeekHandled();
  }, [duration, onSeekHandled, seekTo]);

  const speechMarkers = useMemo(() => {
    return segments.map((segment) => {
      const leftPercent = (segment.start_time / duration) * 100;
      const widthPercent = ((segment.end_time - segment.start_time) / duration) * 100;
      return { id: segment.id, leftPercent, widthPercent };
    });
  }, [duration, segments]);

  return (
    <div className="h-full px-[4px] py-[2px]">
      <audio
        ref={audioRef}
        src={audioUrl}
        preload="metadata"
        onEnded={onEnded}
        onTimeUpdate={(event) => {
          onTimeUpdate(event.currentTarget.currentTime);
        }}
      />

      <div className="mb-[3px] flex items-center justify-between px-[2px] text-[14px] font-semibold text-[var(--text-muted)]">
        <span>{formatTime(currentTime)}</span>
        <span>{formatTime(duration)}</span>
      </div>

      <div
        className="group relative mb-[2px] h-[6px] w-full rounded-full bg-[var(--border-color)] transition-colors duration-200 bg-[var(--border-color)]"
        onClick={(event) => {
          const rect = (event.currentTarget as HTMLDivElement).getBoundingClientRect();
          const ratio = (event.clientX - rect.left) / rect.width;
          onSeek(ratio * duration);
        }}
      >
        <span
          className="absolute left-0 top-0 h-[6px] rounded-full bg-[var(--text-secondary)]"
          style={{ width: `${progressPercent}%` }}
        />

        {speechMarkers.map((marker) => (
          <span
            key={marker.id}
            className="absolute top-0 h-[6px] rounded-full bg-[var(--accent)]"
            style={{
              left: `${marker.leftPercent}%`,
              width: `${Math.max(marker.widthPercent, 1.2)}%`,
            }}
          />
        ))}

        <input
          type="range"
          min={0}
          max={duration}
          step={0.1}
          value={Math.min(duration, Math.max(0, currentTime))}
          onChange={(event) => {
            onSeek(Number(event.target.value));
          }}
          className="timeline-slider absolute left-0 top-0 h-[6px] w-full appearance-none bg-transparent"
          aria-label="Timeline"
        />
      </div>

      <div className="flex justify-center">
        <button
          type="button"
          onClick={onTogglePlay}
          className="group flex h-[40px] w-[40px] items-center justify-center rounded-[8px] bg-transparent transition-all duration-200 ease-out hover:scale-[1.02] hover:shadow-[0_4px_10px_rgba(0,0,0,0.12)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]/60"
          aria-label={isPlaying ? "Pause" : "Play"}
        >
          {isPlaying ? (
            <PauseIcon className="h-[30px] w-[30px] text-[var(--text-muted)] transition-colors duration-200 group-hover:text-[var(--text-primary)]" />
          ) : (
            <PlayTriangleIcon className="h-[34px] w-[34px] text-[var(--text-muted)] transition-colors duration-200 group-hover:text-[var(--text-primary)]" />
          )}
        </button>
      </div>
    </div>
  );
}

