import { ReactNode, useEffect, useMemo, useRef } from "react";
import { Speaker, TranscriptSegment } from "../types";
import { formatTime } from "../utils";
import { SpeakerBadgeIcon } from "./icons";

interface TranscriptListProps {
  segments: TranscriptSegment[];
  speakersById: Record<string, Speaker>;
  activeSegmentId: string | null;
  highlightKeyword?: string;
  onSegmentClick: (segment: TranscriptSegment) => void;
}

function getSpeakerColor(speakerName: string): string {
  if (speakerName === "Jane") {
    return "#8b10ff";
  }
  if (speakerName === "Joe") {
    return "#13b9ef";
  }
  return "var(--text-primary)";
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function renderHighlightedText(content: string, keyword: string): ReactNode {
  const trimmedKeyword = keyword.trim();
  if (!trimmedKeyword) {
    return content;
  }

  const regex = new RegExp(`(${escapeRegExp(trimmedKeyword)})`, "gi");
  const parts = content.split(regex);

  return parts.map((part, index) => {
    if (part.toLowerCase() !== trimmedKeyword.toLowerCase()) {
      return <span key={`${part}-${index}`}>{part}</span>;
    }

    return (
      <mark
        key={`${part}-${index}`}
        style={{ backgroundColor: "transparent" }}
        className="rounded-[6px] px-[4px] text-[var(--text-primary)] border border-[var(--accent)] bg-[linear-gradient(180deg,rgba(143,98,255,0.22)_0%,rgba(23,183,236,0.18)_100%)] shadow-[inset_0_-1px_0_rgba(255,255,255,0.55)]"
      >
        {part}
      </mark>
    );
  });
}

export function TranscriptList({
  segments,
  speakersById,
  activeSegmentId,
  highlightKeyword = "",
  onSegmentClick,
}: TranscriptListProps) {
  const refs = useRef<Record<string, HTMLButtonElement | null>>({});

  useEffect(() => {
    if (!activeSegmentId) {
      return;
    }
    const target = refs.current[activeSegmentId];
    if (target) {
      target.scrollIntoView({ block: "nearest", behavior: "smooth" });
    }
  }, [activeSegmentId]);

  const list = useMemo(
    () =>
      segments.map((segment) => {
        const speaker = speakersById[segment.speaker_id];
        const speakerName = speaker?.speakers_name ?? "Unknown";
        const active = segment.id === activeSegmentId;

        return (
          <button
            key={segment.id}
            type="button"
            ref={(node) => {
              refs.current[segment.id] = node;
            }}
            onClick={() => onSegmentClick(segment)}
            className={`group relative mb-[12px] w-full overflow-hidden rounded-[14px] border px-[16px] py-[12px] text-left shadow-[0_2px_8px_rgba(0,0,0,0.12)] transition-all duration-200 ease-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#9cafff] ${
              active
                ? "border-[var(--accent)] bg-[linear-gradient(95deg,rgba(144,125,255,0.14)_0%,rgba(21,181,235,0.09)_100%)] shadow-[0_0_0_1px_rgba(150,171,255,0.45),0_8px_16px_rgba(109,127,240,0.18)]"
                : "border-transparent bg-[var(--bg-card)] hover:-translate-y-[1px] hover:border-[var(--border-color)] hover:bg-[var(--bg-section) hover:shadow-[0_4px_10px_rgba(0,0,0,0.14)]"
            }`}
          >
            <span
              className={`pointer-events-none absolute left-0 top-[10px] h-[calc(100%-20px)] w-[4px] rounded-r-full transition-opacity duration-200 ${
                active
                  ? "opacity-100 bg-gradient-to-b from-[#8f62ff] to-[#17b7ec]"
                  : "opacity-0 group-hover:opacity-50 bg-[var(--text-muted)]"
              }`}
            />

            <div className="flex w-full flex-col">
              <div className="mb-[8px] w-full text-center text-[11px] font-medium tracking-[0.2px] text-[var(--text-muted)]">
                {formatTime(segment.start_time)} - {formatTime(segment.end_time)}
              </div>

              <div className="flex items-start gap-[12px]">
                <span className="flex h-[36px] w-[36px] flex-none items-center justify-center">
                  <span
                    className="flex h-[32px] w-[32px] items-center justify-center rounded-full shadow-[0_1px_2px_rgba(0,0,0,0.18)]"
                    style={{ backgroundColor: getSpeakerColor(speakerName) }}
                  >
                    <SpeakerBadgeIcon className="h-[24px] w-[24px] text-white" />
                  </span>
                </span>

                <div className="min-w-0 flex-1 pt-[2px] pr-[4px] text-[16px] leading-[1.58] text-[var(--text-secondary)]">
                  <span className="font-semibold text-[var(--text-primary)]">{speakerName}:</span>
                  <span className="ml-[4px]">
                    {renderHighlightedText(segment.content, highlightKeyword)}
                  </span>
                </div>
              </div>
            </div>
          </button>
        );
      }),
    [activeSegmentId, highlightKeyword, onSegmentClick, segments, speakersById]
  );

  if (segments.length === 0) {
    return (
      <div className="flex h-[220px] items-center justify-center rounded-[12px] border border-[var(--accent)] bg-[var(--bg-card)] text-[14px] font-semibold text-[var(--text-muted)]">
        No transcript segments found.
      </div>
    );
  }

  return <>{list}</>;
}


