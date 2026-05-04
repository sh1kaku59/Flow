import { DiaryDetailData, FilterType, Meeting, TranscriptSegment } from "../pages/DiaryDetail/types";
import { fetchMeetingForDetail } from "./MeetingGateway";
import { formatTime } from "../pages/DiaryDetail/utils";

export interface FiltersState {
  filterType: FilterType;
  contentKeyword: string;
  speakerId: string;
  timestampRange: string;
  globalQuery: string;
}

const API_BASE = import.meta.env.VITE_API_BASE_URL || "http://localhost:9000";

const normalize = (value: string) => value.trim().toLowerCase();

function parseRangeLabelToSeconds(label: string): [number, number] | null {
  const match = label.match(/^(\d{2,}):(\d{2})\s*-\s*(\d{2,}):(\d{2})$/);
  if (!match) {
    return null;
  }

  const start = Number(match[1]) * 60 + Number(match[2]);
  const end = Number(match[3]) * 60 + Number(match[4]);
  return [start, end];
}

function normalizeMeetingForDetail(
  source: Awaited<ReturnType<typeof fetchMeetingForDetail>>,
  fallbackTopic?: string,
  fallbackAudioUrl?: string,
  fallbackDuration?: number
): Meeting | null {
  if (!source) {
    return null;
  }

  return {
    id: source.id,
    title: source.title,
    topic: source.topic || fallbackTopic,
    status: source.status,
    created_at: source.created_at,
    duration: source.duration ?? fallbackDuration ?? undefined,
    account_id: source.account_id,
    audio_url: source.audio_url || fallbackAudioUrl || "",
  };
}

export function resolveSupabaseAudioUrl(audioPathOrUrl: string): string {
  if (!audioPathOrUrl) {
    return "";
  }

  if (/^https?:\/\//i.test(audioPathOrUrl)) {
    return audioPathOrUrl;
  }

  return audioPathOrUrl;
}

async function readErrorMessage(response: Response): Promise<string> {
  try {
    const payload = (await response.json()) as { detail?: string; message?: string };
    return payload.detail || payload.message || `Request failed (${response.status}).`;
  } catch {
    return `Request failed (${response.status}).`;
  }
}

interface RawAudioSegment {
  id?: string;
  speaker_label?: string;
  start_time?: number;
  end_time?: number;
  content?: string;
}

interface RawAudioResult {
  audio?: {
    filename?: string | null;
    analysis_data?: {
      topic_name?: string;
    };
  };
  segments?: RawAudioSegment[];
}

interface RawMeetingSummaryResult {
  summary?: string;
}

async function fetchAudioResult(meetingId: string): Promise<RawAudioResult> {
  const response = await fetch(`${API_BASE}/audio/${encodeURIComponent(meetingId)}`, {
    method: "GET",
    credentials: "include",
    headers: {
      Accept: "application/json",
    },
  });

  if (!response.ok) {
    throw new Error(await readErrorMessage(response));
  }

  return (await response.json()) as RawAudioResult;
}

export async function generateMeetingSummary(meetingId: string): Promise<string> {
  const response = await fetch(`${API_BASE}/meetings/${encodeURIComponent(meetingId)}/summary`, {
    method: "POST",
    credentials: "include",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ force: false }),
  });

  if (!response.ok) {
    throw new Error(await readErrorMessage(response));
  }

  const payload = (await response.json()) as RawMeetingSummaryResult;
  return String(payload.summary || "").trim();
}

export async function semanticSearchCurrentMeeting(meetingId: string, query: string): Promise<string[]> {
  if (!query.trim()) return [];
  const response = await fetch(`${API_BASE}/meetings/${encodeURIComponent(meetingId)}/semantic-search?q=${encodeURIComponent(query)}&threshold=0.25`, {
    method: "GET",
    credentials: "include",
    headers: {
      Accept: "application/json",
    },
  });

  if (!response.ok) {
    console.error("Semantic search failed:", await readErrorMessage(response));
    return [];
  }

  const payload = await response.json();
  return Array.isArray(payload.items) ? payload.items : [];
}

function normalizeSpeakerLabel(label: unknown): string {
  const value = String(label || "").trim();
  return value || "UNKNOWN";
}

function buildSpeakersAndSegments(rawSegments: RawAudioSegment[]): {
  speakers: DiaryDetailData["speakers"];
  transcriptSegments: TranscriptSegment[];
} {
  const speakerIdByLabel = new Map<string, string>();
  const speakers: DiaryDetailData["speakers"] = [];

  const transcriptSegments = rawSegments.map((segment, index) => {
    const label = normalizeSpeakerLabel(segment.speaker_label);
    const key = normalize(label);
    let speakerId = speakerIdByLabel.get(key);

    if (!speakerId) {
      speakerId = `speaker-${speakerIdByLabel.size + 1}`;
      speakerIdByLabel.set(key, speakerId);
      speakers.push({
        id: speakerId,
        speakers_name: label,
        avatar_url: "",
        is_identified: !/^speaker\s+\d+$/i.test(label) && label !== "UNKNOWN",
      });
    }

    const startTime = Number(segment.start_time || 0);
    const endTime = Number(segment.end_time || 0);
    return {
      id: String(segment.id || `segment-${index + 1}`),
      meeting_id: "",
      speaker_id: speakerId,
      content: String(segment.content || "").trim(),
      start_time: Number.isFinite(startTime) ? startTime : 0,
      end_time: Number.isFinite(endTime) ? endTime : 0,
    };
  });

  return { speakers, transcriptSegments };
}

export async function fetchDiaryDetail(meetingId: string): Promise<DiaryDetailData> {
  const selectedMeeting = await fetchMeetingForDetail(meetingId);
  if (!selectedMeeting) {
    throw new Error("Diary not found.");
  }

  const audioResult = await fetchAudioResult(meetingId);
  const rawSegments = Array.isArray(audioResult.segments) ? audioResult.segments : [];
  const { speakers, transcriptSegments } = buildSpeakersAndSegments(rawSegments);

  const detectedTopic = String(audioResult.audio?.analysis_data?.topic_name || "").trim();
  const topicFallback = detectedTopic && detectedTopic.toUpperCase() !== "UNKNOWN" ? detectedTopic : undefined;
  const durationFallback = transcriptSegments.length
    ? Math.max(...transcriptSegments.map((segment) => segment.end_time))
    : undefined;

  const meeting = normalizeMeetingForDetail(
    selectedMeeting,
    topicFallback,
    String(audioResult.audio?.filename || "").trim() || undefined,
    durationFallback
  );
  if (!meeting) throw new Error("Diary not found.");

  const hydratedSegments = transcriptSegments.map((segment) => ({
    ...segment,
    meeting_id: meeting.id,
  }));

  return {
    meeting,
    speakers,
    transcriptSegments: hydratedSegments,
  };
}

export function filterTranscriptSegments(
  source: TranscriptSegment[],
  filters: FiltersState,
  semanticMatchedIds?: string[] | null
): TranscriptSegment[] {
  const contentKeyword = normalize(filters.contentKeyword);
  const globalQuery = normalize(filters.globalQuery);

  const timestampRange =
    filters.timestampRange === ""
      ? null
      : parseRangeLabelToSeconds(filters.timestampRange);

  return source.filter((segment) => {
    let byGlobalQuery = true;
    if (globalQuery !== "") {
      if (semanticMatchedIds && semanticMatchedIds.length > 0) {
        byGlobalQuery = semanticMatchedIds.includes(segment.id);
      } else if (semanticMatchedIds && semanticMatchedIds.length === 0) {
        byGlobalQuery = false; // Query exists but AI found 0 results
      } else {
        // Fallback to keyword search
        byGlobalQuery = normalize(segment.content).includes(globalQuery);
      }
    }

    if (filters.filterType === "Content") {
      const byContent =
        contentKeyword === "" || normalize(segment.content).includes(contentKeyword);
      return byGlobalQuery && byContent;
    }

    if (filters.filterType === "Speaker") {
      const bySpeaker =
        filters.speakerId === "" ||
        normalize(filters.speakerId) === "all" ||
        segment.speaker_id === filters.speakerId;
      return byGlobalQuery && bySpeaker;
    }

    if (filters.filterType === "Timestamp") {
      if (!timestampRange) {
        return byGlobalQuery;
      }
      const selectedLabel = filters.timestampRange.trim();
      const segmentLabel = `${formatTime(segment.start_time)} - ${formatTime(segment.end_time)}`;
      return byGlobalQuery && segmentLabel === selectedLabel;
    }

    return byGlobalQuery;
  });
}
