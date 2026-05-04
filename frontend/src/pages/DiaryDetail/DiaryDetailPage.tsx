import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { AudioPlayer } from "./components/AudioPlayer";
import { FilterBar } from "./components/FilterBar";
import Header from "../../components/Header";
import { SearchBar } from "./components/SearchBar";
import { SpeakerBehaviorModal } from "./components/SpeakerBehaviorModal";
import { SummaryModal } from "./components/SummaryModal";
import { TranscriptList } from "./components/TranscriptList";
import {
  FiltersState,
  fetchDiaryDetail,
  filterTranscriptSegments,
  generateMeetingSummary,
  resolveSupabaseAudioUrl,
  semanticSearchCurrentMeeting,
} from "../../services/DiaryDetailMockApi";
import { BackIcon } from "./components/Icons";
import { Meeting, Speaker, TranscriptSegment, TimestampOption } from "./types";
import { formatTime } from "./utils";

interface DiaryDetailPageProps {
  meetingId: string;
}

const DEFAULT_FILTERS: FiltersState = {
  filterType: "Content",
  contentKeyword: "",
  speakerId: "ALL",
  timestampRange: "ALL",
  globalQuery: "",
};

function buildTimestampOptionsFromSegments(
  segments: TranscriptSegment[]
): TimestampOption[] {
  const sorted = [...segments].sort((left, right) => left.start_time - right.start_time);
  const seen = new Set<string>();

  return sorted.reduce<TimestampOption[]>((acc, segment) => {
    const label = `${formatTime(segment.start_time)} - ${formatTime(segment.end_time)}`;
    if (seen.has(label)) {
      return acc;
    }

    seen.add(label);
    acc.push({
      label,
      start: segment.start_time,
      end: segment.end_time,
    });
    return acc;
  }, []);
}

export function DiaryDetailPage({ meetingId }: DiaryDetailPageProps) {
  const { t } = useTranslation();
  const [meeting, setMeeting] = useState<Meeting | null>(null);
  const [speakers, setSpeakers] = useState<Speaker[]>([]);
  const [allSegments, setAllSegments] = useState<TranscriptSegment[]>([]);
  const [filters, setFilters] = useState<FiltersState>(DEFAULT_FILTERS);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState("");

  const [currentTime, setCurrentTime] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [seekTo, setSeekTo] = useState<number | null>(null);
  const [isBehaviorModalOpen, setIsBehaviorModalOpen] = useState(false);
  const [isSummaryModalOpen, setIsSummaryModalOpen] = useState(false);
  const [isSummaryLoading, setIsSummaryLoading] = useState(false);
  const [summaryText, setSummaryText] = useState("");
  const [summaryError, setSummaryError] = useState("");

  const [semanticMatchedIds, setSemanticMatchedIds] = useState<string[] | null>(null);

  useEffect(() => {
    let mounted = true;

    setIsLoading(true);
    setLoadError("");
    setFilters(DEFAULT_FILTERS);
    setCurrentTime(0);
    setIsPlaying(false);
    setSeekTo(null);
    setIsBehaviorModalOpen(false);
    setIsSummaryModalOpen(false);
    setIsSummaryLoading(false);
    setSummaryText("");
    setSummaryError("");

    fetchDiaryDetail(meetingId)
      .then((data) => {
        if (!mounted) {
          return;
        }
        setMeeting(data.meeting);
        setSpeakers(data.speakers);
        setAllSegments(data.transcriptSegments);
      })
      .catch((error) => {
        if (!mounted) {
          return;
        }
        setLoadError(
          error instanceof Error ? error.message : t("unable_load_diary_detail")
        );
      })
      .finally(() => {
        if (mounted) {
          setIsLoading(false);
        }
      });

    return () => {
      mounted = false;
    };
  }, [meetingId, t]);

  const speakersById = useMemo(() => {
    return speakers.reduce<Record<string, Speaker>>((acc, speaker) => {
      acc[speaker.id] = speaker;
      return acc;
    }, {});
  }, [speakers]);

  const speakerOptions = useMemo(() => {
    return speakers.map((speaker) => ({
      id: speaker.id,
      name: speaker.speakers_name,
    }));
  }, [speakers]);

  const timestampOptions = useMemo(
    () => buildTimestampOptionsFromSegments(allSegments),
    [allSegments]
  );

  useEffect(() => {
    if (!filters.globalQuery.trim()) {
      setSemanticMatchedIds(null);
      return;
    }

    const handler = setTimeout(() => {
      semanticSearchCurrentMeeting(meetingId, filters.globalQuery)
        .then((matchedIds) => {
          setSemanticMatchedIds(matchedIds);
        })
        .catch(() => {
          setSemanticMatchedIds(null);
        });
    }, 500);

    return () => clearTimeout(handler);
  }, [filters.globalQuery, meetingId]);

  const filteredSegments = useMemo(() => {
    return filterTranscriptSegments(allSegments, filters, semanticMatchedIds);
  }, [allSegments, filters, semanticMatchedIds]);

  const activeSegmentId = useMemo(() => {
    const active = filteredSegments.find(
      (segment) => currentTime >= segment.start_time && currentTime < segment.end_time
    );
    return active ? active.id : null;
  }, [currentTime, filteredSegments]);

  const audioUrl = meeting ? resolveSupabaseAudioUrl(meeting.audio_url) : "";

  const audioDuration = useMemo(() => {
    if (meeting?.duration && meeting.duration > 0) {
      return meeting.duration;
    }

    if (allSegments.length === 0) {
      return 0;
    }

    return Math.max(...allSegments.map((segment) => segment.end_time));
  }, [allSegments, meeting?.duration]);

  const isCompletedMeeting = meeting?.status ? meeting.status === "Completed" : true;
  const topicValue = meeting?.topic?.trim() || t("no_topic_available");

  const handleSegmentClick = (segment: TranscriptSegment) => {
    setSeekTo(segment.start_time);
    setCurrentTime(segment.start_time);
  };

  const handleSummaryClick = async () => {
    setIsSummaryModalOpen(true);
    setIsSummaryLoading(true);
    setSummaryError("");
    setSummaryText("");

    try {
      const summary = await generateMeetingSummary(meetingId);
      setSummaryText(summary);
    } catch (error) {
      setSummaryError(error instanceof Error ? error.message : t("unable_generate_summary"));
    } finally {
      setIsSummaryLoading(false);
    }
  };

  if (isLoading) {
    return (
      <main className="h-screen w-full bg-[#f5f5f5] flex justify-center overflow-hidden">
        <div className="w-full h-full flex flex-col">
          <Header />
          <div className="flex-1 min-h-0 px-6 py-4">
            <div className="mx-auto w-full">
              <div className="text-[14px] font-semibold text-[#666]">{t("loading_diary_detail")}</div>
            </div>
          </div>
        </div>
      </main>
    );
  }

  if (loadError || !meeting) {
    return (
      <main className="h-screen w-full bg-[#f5f5f5] flex justify-center overflow-hidden">
        <div className="w-full h-full flex flex-col">
          <Header />
          <div className="flex-1 min-h-0 px-6 py-4">
            <div className="mx-auto w-full">
              <div className="text-[14px] font-semibold text-[#666]">
                {loadError || t("missing_meeting_data")}
              </div>
            </div>
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="h-screen w-full bg-[var(--bg-main)] text-[var(--text-primary)] flex justify-center overflow-hidden transition-colors duration-300">
      <div className="w-full h-full flex flex-col">
        <Header />

        <div className="flex-1 min-h-0 px-6 py-[10px]">
          <section className="mx-auto flex h-full w-full min-h-0 flex-col overflow-hidden rounded-[16px] bg-[var(--bg-section)] p-[14px] shadow-[inset_0_1px_0_rgba(255,255,255,0.38)] transition-shadow duration-200">
            <div className="flex-shrink-0">
              <div className="grid h-[82px] grid-cols-[auto_1fr_auto] items-center rounded-[12px] bg-[var(--bg-card)] px-[22px]">
                <button
                  type="button"
                  onClick={() => window.history.back()}
                  className="flex items-center gap-[6px] rounded-[10px] px-[6px] py-[4px] text-[14px] font-semibold text-[var(--text-secondary)] transition-all duration-200 ease-out hover:-translate-y-[1px] hover:bg-[var(--btn-cancel-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#8fa2ff]"
                >
                  <BackIcon className="h-[18px] w-[18px]" />
                  {t("back")}
                </button>
                <h1 className="justify-self-center text-[28px] font-bold">{meeting.title}</h1>
                <div className="w-[72px]" />
              </div>

              <div className="mt-[10px]">
                <SearchBar
                  value={filters.globalQuery}
                  onChange={(value) =>
                    setFilters((prev) => ({
                      ...prev,
                      globalQuery: value,
                    }))
                  }
                  onChartClick={() => setIsBehaviorModalOpen(true)}
                  onSummaryClick={handleSummaryClick}
                  summaryLoading={isSummaryLoading}
                />
              </div>

              <div className="mt-[8px] h-[1px] bg-[var(--divider)]" />

              <div className="mt-[8px] rounded-[12px] border border-[var(--border-color)] bg-[var(--bg-card)] px-[20px] py-[15px] text-center shadow-[inset_0_1px_0_rgba(255,255,255,0.7)] transition-shadow duration-200">
                <p className="text-[26px] font-bold leading-none tracking-[0.2px]">{topicValue}</p>
              </div>
            </div>

            <div className="mt-[8px] flex min-h-0 flex-1 flex-col rounded-[12px] bg-[var(--bg-card)] px-[12px] pb-[10px] pt-[10px] shadow-[inset_0_1px_0_rgba(255,255,255,0.8)] transition-shadow duration-200">
              {isCompletedMeeting ? (
                <>
                  <div className="flex-shrink-0">
                    <FilterBar
                      filterType={filters.filterType}
                      onFilterTypeChange={(value) =>
                        setFilters((prev) => ({
                          ...prev,
                          filterType: value,
                          contentKeyword: value === "Content" ? prev.contentKeyword : "",
                          speakerId: value === "Speaker" ? prev.speakerId : "ALL",
                          timestampRange: value === "Timestamp" ? prev.timestampRange : "ALL",
                        }))
                      }
                      contentKeyword={filters.contentKeyword}
                      onContentKeywordChange={(value) =>
                        setFilters((prev) => ({
                          ...prev,
                          contentKeyword: value,
                        }))
                      }
                      speakerId={filters.speakerId}
                      speakerOptions={speakerOptions}
                      onSpeakerChange={(speakerId) =>
                        setFilters((prev) => ({
                          ...prev,
                          speakerId,
                        }))
                      }
                      timestampRange={filters.timestampRange}
                      timestampOptions={timestampOptions}
                      onTimestampChange={(value) =>
                        setFilters((prev) => ({
                          ...prev,
                          timestampRange: value,
                        }))
                      }
                    />
                  </div>

                  <div className="mt-[10px] flex flex-1 min-h-0 flex-col">
                    <div className="flex-1 min-h-0 overflow-y-auto px-[6px]">
                      <TranscriptList
                        segments={filteredSegments}
                        speakersById={speakersById}
                        activeSegmentId={activeSegmentId}
                        highlightKeyword={
                          filters.filterType === "Content" ? filters.contentKeyword : ""
                        }
                        onSegmentClick={handleSegmentClick}
                      />
                    </div>

                    <div className="mt-[8px] h-[88px] flex-shrink-0 rounded-[10px] bg-[var(--bg-section)] px-[8px] py-[4px] shadow-[inset_0_1px_0_rgba(255,255,255,0.6)]">
                      <AudioPlayer
                        audioUrl={audioUrl}
                        duration={audioDuration}
                        currentTime={currentTime}
                        isPlaying={isPlaying}
                        seekTo={seekTo}
                        segments={allSegments}
                        onSeekHandled={() => setSeekTo(null)}
                        onTogglePlay={() => setIsPlaying((prev) => !prev)}
                        onSeek={(seconds) => {
                          setSeekTo(seconds);
                          setCurrentTime(seconds);
                        }}
                        onTimeUpdate={setCurrentTime}
                        onEnded={() => setIsPlaying(false)}
                      />
                    </div>
                  </div>
                </>
              ) : (
                <div className="flex flex-1 items-center justify-center rounded-[10px] border border-[var(--border-color)] bg-[var(--bg-card)] px-[20px] text-center text-[16px] font-semibold text-[var(--text-muted)]">
                  {t("detailed_transcript_only_completed")}
                </div>
              )}
            </div>
          </section>
        </div>
      </div>

      <SpeakerBehaviorModal
        isOpen={isBehaviorModalOpen}
        onClose={() => setIsBehaviorModalOpen(false)}
        speakers={speakers}
        segments={allSegments}
      />
      <SummaryModal
        isOpen={isSummaryModalOpen}
        onClose={() => setIsSummaryModalOpen(false)}
        title={meeting.title}
        summary={summaryText}
        loading={isSummaryLoading}
        error={summaryError}
      />
    </main>
  );
}
