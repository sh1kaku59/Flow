import { Meeting, MeetingStatus } from "./types";

const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL ?? "http://localhost:9000").replace(
  /\/+$/,
  ""
);

function buildApiUrl(path: string): string {
  if (!path.startsWith("/")) {
    throw new Error("API path must start with '/'.");
  }
  return API_BASE_URL ? `${API_BASE_URL}${path}` : path;
}

function isMeetingStatus(value: string): value is MeetingStatus {
  return (
    value === "Pending" ||
    value === "Processing" ||
    value === "Completed" ||
    value === "Failed"
  );
}

function normalizeStatus(raw: unknown): MeetingStatus {
  if (typeof raw !== "string") {
    return "Pending";
  }

  const normalized = raw.trim().toLowerCase();
  const titleCase = `${normalized.slice(0, 1).toUpperCase()}${normalized.slice(1)}`;

  if (isMeetingStatus(titleCase)) {
    return titleCase;
  }

  return "Pending";
}

function toNumberOrNull(raw: unknown): number | null {
  if (typeof raw === "number" && Number.isFinite(raw)) {
    return raw;
  }

  if (typeof raw === "string" && raw.trim() !== "") {
    const value = Number(raw);
    if (Number.isFinite(value)) {
      return value;
    }
  }

  return null;
}

function readDuration(raw: Record<string, unknown>): number | null {
  const directDuration = toNumberOrNull(raw.duration);
  if (directDuration !== null) {
    return directDuration;
  }

  const audioFile = raw.audio_file;
  if (audioFile && typeof audioFile === "object") {
    const value = toNumberOrNull((audioFile as Record<string, unknown>).duration);
    if (value !== null) {
      return value;
    }
  }

  const audioFileCamel = raw.audioFile;
  if (audioFileCamel && typeof audioFileCamel === "object") {
    const value = toNumberOrNull((audioFileCamel as Record<string, unknown>).duration);
    if (value !== null) {
      return value;
    }
  }

  return null;
}

function readAudioUrl(raw: Record<string, unknown>): string | undefined {
  const direct = raw.audio_url;
  if (typeof direct === "string" && direct.trim() !== "") {
    return direct;
  }

  const audioFile = raw.audio_file;
  if (audioFile && typeof audioFile === "object") {
    const value = (audioFile as Record<string, unknown>).file_url;
    if (typeof value === "string" && value.trim() !== "") {
      return value;
    }
  }

  const audioFileCamel = raw.audioFile;
  if (audioFileCamel && typeof audioFileCamel === "object") {
    const value = (audioFileCamel as Record<string, unknown>).file_url;
    if (typeof value === "string" && value.trim() !== "") {
      return value;
    }
  }

  return undefined;
}

function normalizeMeeting(raw: unknown): Meeting | null {
  if (!raw || typeof raw !== "object") {
    return null;
  }

  const source = raw as Record<string, unknown>;
  const id = source.id;
  const createdAt = source.created_at;
  const title = source.title;

  if (typeof id !== "string" || id.trim() === "") {
    return null;
  }

  if (typeof createdAt !== "string" || createdAt.trim() === "") {
    return null;
  }

  return {
    id,
    account_id: typeof source.account_id === "string" ? source.account_id : undefined,
    title: typeof title === "string" ? title : "Untitled",
    topic: typeof source.topic === "string" ? source.topic : undefined,
    status: normalizeStatus(source.status),
    created_at: createdAt,
    duration: readDuration(source),
    audio_url: readAudioUrl(source),
  };
}

function extractMeetings(payload: unknown): unknown[] {
  if (Array.isArray(payload)) {
    return payload;
  }

  if (payload && typeof payload === "object") {
    const result = payload as Record<string, unknown>;
    if (Array.isArray(result.meetings)) {
      return result.meetings;
    }
    if (Array.isArray(result.data)) {
      return result.data;
    }
  }

  return [];
}

async function readErrorMessage(response: Response): Promise<string> {
  try {
    const payload = (await response.json()) as { message?: string; error?: string };
    return payload.message || payload.error || `Request failed (${response.status}).`;
  } catch {
    return `Request failed (${response.status}).`;
  }
}

interface SemanticMeetingSearchItem {
  meeting_id?: string;
  score?: number;
}

export async function fetchMeetings(signal?: AbortSignal): Promise<Meeting[]> {
  const response = await fetch(buildApiUrl("/meetings"), {
    method: "GET",
    credentials: "include",
    headers: {
      Accept: "application/json",
    },
    signal,
  });

  if (!response.ok) {
    throw new Error(await readErrorMessage(response));
  }

  const payload = (await response.json()) as unknown;
  return extractMeetings(payload)
    .map(normalizeMeeting)
    .filter((meeting): meeting is Meeting => meeting !== null);
}

export async function fetchMeetingById(
  meetingId: string,
  signal?: AbortSignal
): Promise<Meeting | null> {
  const meetings = await fetchMeetings(signal);
  const meeting = meetings.find((item) => item.id === meetingId);
  return meeting ?? null;
}

export async function patchMeetingTitle(id: string, title: string): Promise<void> {
  const response = await fetch(buildApiUrl(`/meetings/${encodeURIComponent(id)}`), {
    method: "PATCH",
    credentials: "include",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ title }),
  });

  if (!response.ok) {
    throw new Error(await readErrorMessage(response));
  }
}

export async function searchMeetingsSemantic(
  query: string,
  signal?: AbortSignal
): Promise<Array<{ meetingId: string; score: number }>> {
  const q = query.trim();
  if (!q) {
    return [];
  }

  const url = new URL(buildApiUrl("/meetings/semantic-search"), window.location.origin);
  url.searchParams.set("q", q);
  url.searchParams.set("top_k", "50");

  const response = await fetch(url.toString(), {
    method: "GET",
    credentials: "include",
    headers: {
      Accept: "application/json",
    },
    signal,
  });

  if (!response.ok) {
    throw new Error(await readErrorMessage(response));
  }

  const payload = (await response.json()) as { items?: SemanticMeetingSearchItem[] };
  return (Array.isArray(payload.items) ? payload.items : [])
    .map((item) => ({
      meetingId: typeof item.meeting_id === "string" ? item.meeting_id : "",
      score: typeof item.score === "number" ? item.score : 0,
    }))
    .filter((item) => item.meetingId);
}
