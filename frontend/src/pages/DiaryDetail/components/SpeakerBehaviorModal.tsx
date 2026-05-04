import { useEffect, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Activity, GitBranch, Lightbulb, MessageSquare, Mic, X } from "lucide-react";
import { Speaker, TranscriptSegment } from "../types";
import { formatTime } from "../utils";

interface SpeakerBehaviorModalProps {
  isOpen: boolean;
  onClose: () => void;
  speakers: Speaker[];
  segments: TranscriptSegment[];
}

interface SpeakerStat {
  id: string;
  name: string;
  duration: number;
  turns: number;
  words: number;
  percent: number;
  color: string;
}

interface TopicMarker {
  label: string;
  time: number;
  color: string;
}

const SPEAKER_COLORS = ["#7a6df6", "#f08a86", "#32b8d5", "#4ecb71", "#f39b46", "#c35df5"];
const TOPIC_COLORS = ["#4ba6ff", "#55c76a", "#f3924b", "#cc62ff"];
const TOPIC_FALLBACKS = ["Introduction", "Planning", "Review", "Conclusion"];

function countWords(text: string): number {
  const value = text.trim();
  if (!value) {
    return 0;
  }
  return value.split(/\s+/).length;
}

function toTitleCase(text: string): string {
  return text
    .toLowerCase()
    .split(" ")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function buildTopicLabel(content: string, fallback: string): string {
  const cleaned = content
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!cleaned) {
    return fallback;
  }

  const words = cleaned.split(" ").slice(0, 3).join(" ");
  const label = toTitleCase(words);
  return label || fallback;
}

function formatDuration(seconds: number): string {
  const safe = Math.max(0, Math.round(seconds));
  const minutes = Math.floor(safe / 60);
  const remain = safe % 60;
  return `${String(minutes).padStart(2, "0")}:${String(remain).padStart(2, "0")}`;
}

function getTotalTimeline(segments: TranscriptSegment[]): number {
  if (segments.length === 0) {
    return 0;
  }
  const maxEnd = Math.max(...segments.map((segment) => Math.max(segment.end_time, segment.start_time)));
  return Math.max(0, maxEnd);
}

function buildIntensityPoints(segments: TranscriptSegment[], totalSeconds: number): number[] {
  const pointCount = 8;
  if (pointCount <= 1 || totalSeconds <= 0) {
    return Array(pointCount).fill(0);
  }

  return Array.from({ length: pointCount }, (_, index) => {
    const anchor = (index / (pointCount - 1)) * totalSeconds;
    return segments.reduce((score, segment) => {
      if (anchor < segment.start_time || anchor > segment.end_time) {
        return score;
      }
      return score + 1 + Math.min(3, countWords(segment.content) / 18);
    }, 0);
  });
}

function buildLinePath(points: number[], width: number, height: number): string {
  if (points.length === 0) {
    return "";
  }

  const maxValue = Math.max(...points, 1);
  return points
    .map((point, index) => {
      const x = (index / Math.max(1, points.length - 1)) * width;
      const y = height - (point / maxValue) * (height - 8);
      return `${index === 0 ? "M" : "L"} ${x.toFixed(2)} ${y.toFixed(2)}`;
    })
    .join(" ");
}

function buildAreaPath(points: number[], width: number, height: number): string {
  const line = buildLinePath(points, width, height);
  if (!line) {
    return "";
  }
  return `${line} L ${width} ${height} L 0 ${height} Z`;
}

export function SpeakerBehaviorModal({
  isOpen,
  onClose,
  speakers,
  segments,
}: SpeakerBehaviorModalProps) {
  const { t } = useTranslation();
  useEffect(() => {
    if (!isOpen) {
      return;
    }

    const handleKeydown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };

    window.addEventListener("keydown", handleKeydown);
    return () => window.removeEventListener("keydown", handleKeydown);
  }, [isOpen, onClose]);

  const speakerStats = useMemo<SpeakerStat[]>(() => {
    const speakerNameById = speakers.reduce<Record<string, string>>((acc, speaker) => {
      acc[speaker.id] = speaker.speakers_name || "Unknown";
      return acc;
    }, {});

    const byId = new Map<string, Omit<SpeakerStat, "percent" | "color">>();
    segments.forEach((segment) => {
      const id = segment.speaker_id || "unknown";
      const current = byId.get(id);
      const duration = Math.max(0, segment.end_time - segment.start_time);
      const words = countWords(segment.content);

      if (!current) {
        byId.set(id, {
          id,
          name: speakerNameById[id] || "Unknown",
          duration,
          turns: 1,
          words,
        });
        return;
      }

      current.duration += duration;
      current.turns += 1;
      current.words += words;
    });

    const rows = Array.from(byId.values()).sort((left, right) => right.duration - left.duration);
    const totalDuration = rows.reduce((sum, row) => sum + row.duration, 0);
    return rows.map((row, index) => ({
      ...row,
      percent: totalDuration > 0 ? (row.duration / totalDuration) * 100 : 0,
      color: SPEAKER_COLORS[index % SPEAKER_COLORS.length],
    }));
  }, [segments, speakers]);

  const totalSpeakingSeconds = useMemo(
    () => speakerStats.reduce((sum, speaker) => sum + speaker.duration, 0),
    [speakerStats]
  );

  const totalTimelineSeconds = useMemo(() => getTotalTimeline(segments), [segments]);

  const topicMarkers = useMemo<TopicMarker[]>(() => {
    if (totalTimelineSeconds <= 0) {
      return TOPIC_FALLBACKS.map((label, index) => ({
        label,
        time: index * 5 * 60,
        color: TOPIC_COLORS[index % TOPIC_COLORS.length],
      }));
    }

    const anchors = [0, 0.33, 0.66, 0.95].map((ratio) => ratio * totalTimelineSeconds);
    return anchors.map((anchor, index) => {
      const nearest = [...segments].sort(
        (left, right) =>
          Math.abs(left.start_time - anchor) - Math.abs(right.start_time - anchor)
      )[0];
      return {
        label: buildTopicLabel(nearest?.content || "", TOPIC_FALLBACKS[index]),
        time: anchor,
        color: TOPIC_COLORS[index % TOPIC_COLORS.length],
      };
    });
  }, [segments, totalTimelineSeconds]);

  const intensityPoints = useMemo(
    () => buildIntensityPoints(segments, totalTimelineSeconds),
    [segments, totalTimelineSeconds]
  );
  const peakIntensityIndex = useMemo(() => {
    if (intensityPoints.length === 0) {
      return 0;
    }
    let peakIndex = 0;
    for (let index = 1; index < intensityPoints.length; index += 1) {
      if (intensityPoints[index] > intensityPoints[peakIndex]) {
        peakIndex = index;
      }
    }
    return peakIndex;
  }, [intensityPoints]);
  const peakTime = useMemo(() => {
    if (intensityPoints.length <= 1) {
      return 0;
    }
    return (peakIntensityIndex / (intensityPoints.length - 1)) * totalTimelineSeconds;
  }, [intensityPoints.length, peakIntensityIndex, totalTimelineSeconds]);

  const dominantSpeaker = speakerStats[0];
  const turnsMax = Math.max(...speakerStats.map((speaker) => speaker.turns), 1);
  const donutGradient = useMemo(() => {
    if (!speakerStats.length) {
      return "conic-gradient(#d2d7e2 0 100%)";
    }
    let cursor = 0;
    const stops = speakerStats.map((speaker) => {
      const start = cursor;
      cursor += speaker.percent;
      return `${speaker.color} ${start.toFixed(2)}% ${cursor.toFixed(2)}%`;
    });
    return `conic-gradient(${stops.join(", ")})`;
  }, [speakerStats]);

  if (!isOpen) {
    return null;
  }

  return (
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/40 backdrop-blur-sm px-4 py-6"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={t("speaker_behavior_analysis")}
    >
      <section
        className="max-h-[92vh] w-full max-w-[1080px] overflow-auto rounded-[24px] bg-[var(--modal-bg)] text-[var(--modal-text)] p-6 shadow-[0_25px_45px_rgba(10,10,30,0.25)] md:p-7"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="mb-5 flex items-center justify-between">
          <div>
            <h2 className="text-[34px] font-extrabold leading-tight text-[var(--modal-text)]">
              {t("speaker_behavior_analysis")}
            </h2>
            <p className="mt-1 text-[14px] font-medium text-[var(--modal-text)]">
              {t("based_on_transcript")}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full p-2 text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-section)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#a6b4ff]"
            aria-label="Close modal"
          >
            <X className="h-8 w-8" />
          </button>
        </header>

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <article className="rounded-[18px] bg-[var(--bg-section)] p-5">
            <div className="mb-4 flex items-center gap-2 text-[27px] font-bold text-[#14a3d5]">
              <Mic className="h-7 w-7" />
              <span>{t("speaking_time_distribution")}</span>
            </div>

            <div className="flex flex-col gap-5 md:flex-row md:items-center">
              <div className="relative mx-auto h-[200px] w-[200px]">
                <div
                  className="h-full w-full rounded-full"
                  style={{ background: donutGradient }}
                  aria-hidden="true"
                />
                <div className="absolute inset-[34px] flex flex-col items-center justify-center rounded-full bg-[var(--modal-bg)]">
                  <span className="text-[16px] font-semibold text-[var(--text-muted)]">{t("total")}</span>
                  <span className="text-[34px] font-extrabold text-[var(--text-muted)]">
                    {formatDuration(totalSpeakingSeconds)}
                  </span>
                  <span className="text-[16px] font-medium text-[var(--text-muted)]">{t("min")}</span>
                </div>
              </div>

              <ul className="flex-1 space-y-3">
                {speakerStats.map((speaker) => (
                  <li key={speaker.id} className="grid grid-cols-[auto_1fr_auto_auto] items-center gap-2">
                    <span
                      className="h-3 w-3 rounded-full"
                      style={{ backgroundColor: speaker.color }}
                      aria-hidden="true"
                    />
                    <span className="truncate text-[15px] font-semibold text-[var(--modal-text)]">{speaker.name}</span>
                    <span className="text-[14px] font-semibold text-[var(--text-primary)]">
                      {formatDuration(speaker.duration)}
                    </span>
                    <span className="text-[13px] font-semibold text-[#7887f7]">
                      {speaker.percent.toFixed(1)}%
                    </span>
                  </li>
                ))}
                {speakerStats.length === 0 ? (
                  <li className="text-[14px] font-medium text-[#75757c]">
                    {t("no_speaker_timeline")}
                  </li>
                ) : null}
              </ul>
            </div>
          </article>

          <article className="rounded-[18px] bg-[var(--modal-bg)] p-5">
            <div className="mb-4 flex items-center gap-2 text-[27px] font-bold text-[#19b848]">
              <Activity className="h-7 w-7" />
              <span>{t("participation_frequency")}</span>
            </div>

            <div className="space-y-4">
              {speakerStats.map((speaker) => (
                <div key={speaker.id}>
                  <div className="mb-1 text-[15px] font-semibold text-[#34343d]">{speaker.name}</div>
                  <div className="grid grid-cols-[1fr_auto] items-center gap-3">
                    <div className="h-[12px] rounded-full bg-[var(--divider)]">
                      <div
                        className="h-full rounded-full"
                        style={{
                          width: `${Math.max(8, (speaker.turns / turnsMax) * 100)}%`,
                          backgroundColor: speaker.color,
                        }}
                      />
                    </div>
                    <div className="text-[14px] font-semibold text-[#5e5e68]">{t("turns_count", { count: speaker.turns })}</div>
                  </div>
                </div>
              ))}
              {speakerStats.length === 0 ? (
                <div className="text-[14px] font-medium text-[#75757c]">
                  {t("no_participation_data")}
                </div>
              ) : null}
            </div>
          </article>

          <article className="rounded-[18px] bg-[var(--modal-bg)] p-5">
            <div className="mb-5 flex items-center gap-2 text-[27px] font-bold text-[#f26f22]">
              <GitBranch className="h-7 w-7" />
              <span>{t("topic_transition_indicators")}</span>
            </div>

            <div className="space-y-7">
              <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                {topicMarkers.map((marker) => (
                  <div
                    key={`${marker.label}-${marker.time}`}
                    className="rounded-[12px] border border-[var(--border-color)] bg-[var(--bg-card)] px-3 py-2 text-center text-[13px] font-bold"
                    style={{ borderColor: marker.color, color: marker.color }}
                  >
                    {marker.label}
                  </div>
                ))}
              </div>

              <div className="relative pt-2">
                <div className="h-[6px] rounded-full bg-[#cfd4dd]" />
                <div className="absolute inset-x-0 top-0 flex justify-between">
                  {topicMarkers.map((marker) => (
                    <div key={`dot-${marker.label}-${marker.time}`} className="flex flex-col items-center">
                      <span
                        className="h-4 w-4 rounded-full border-2 border-white shadow-[0_1px_4px_rgba(0,0,0,0.15)]"
                        style={{ backgroundColor: marker.color }}
                      />
                      <span className="mt-2 text-[12px] font-semibold text-[#63636b]">
                        {formatTime(marker.time)}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </article>

          <article className="rounded-[18px] bg-[var(--modal-bg)] p-5">
            <div className="mb-3 flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 text-[27px] font-bold text-[#da23ea]">
                <MessageSquare className="h-7 w-7" />
                <span>{t("discussion_intensity")}</span>
              </div>
              <div className="rounded-full border border-[#b06fff] px-3 py-1 text-[13px] font-bold text-[#7d2ce4]">
                {t("peak_at")} {formatTime(peakTime)}
              </div>
            </div>

            <div className="rounded-[12px] border border-[#d5d5da] bg-[var(--modal-section)] p-3">
              <svg viewBox="0 0 640 220" className="h-[220px] w-full">
                <defs>
                  <linearGradient id="intensityFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#8d72ff" stopOpacity="0.45" />
                    <stop offset="100%" stopColor="#8d72ff" stopOpacity="0.08" />
                  </linearGradient>
                </defs>

                <g stroke="#d4d6de" strokeWidth="1">
                  <line x1="0" y1="30" x2="640" y2="30" />
                  <line x1="0" y1="80" x2="640" y2="80" />
                  <line x1="0" y1="130" x2="640" y2="130" />
                  <line x1="0" y1="180" x2="640" y2="180" />
                </g>

                <path d={buildAreaPath(intensityPoints, 640, 200)} fill="url(#intensityFill)" />
                <path
                  d={buildLinePath(intensityPoints, 640, 200)}
                  fill="none"
                  stroke="#7f68ff"
                  strokeWidth="4"
                />
              </svg>

              <div className="mt-1 flex justify-between text-[12px] font-semibold text-[#696977]">
                <span>00:00</span>
                <span>{formatTime(totalTimelineSeconds * 0.33)}</span>
                <span>{formatTime(totalTimelineSeconds * 0.66)}</span>
                <span>{formatTime(totalTimelineSeconds)}</span>
              </div>
            </div>
          </article>
        </div>

        <article className="mt-4 rounded-[16px] bg-[var(--modal-bg)] px-5 py-4">
          <div className="flex items-center gap-2 text-[26px] font-bold text-[#9023ff]">
            <Lightbulb className="h-7 w-7" />
            <span>{t("insights")}</span>
          </div>
          <p className="mt-2 text-[16px] font-medium leading-relaxed text-[#4f4f58]">
            {dominantSpeaker
              ? t("insight_dominated", {
                  name: dominantSpeaker.name,
                  percent: dominantSpeaker.percent.toFixed(1),
                  peakTime: formatTime(peakTime),
                  turns: dominantSpeaker.turns
                })
              : t("not_enough_data_insights")}
          </p>
        </article>
      </section>
    </div>
  );
}
