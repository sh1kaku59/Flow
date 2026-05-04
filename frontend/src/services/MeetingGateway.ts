import { fetchMeetingById } from "./DiaryService";
import type { Meeting } from "../pages/DiaryList/types";

// Temporary integration boundary for detail-page meeting lookup.
// Keeps current behavior unchanged while avoiding direct detail -> list/api coupling.
export async function fetchMeetingForDetail(
  meetingId: string,
  signal?: AbortSignal
): Promise<Meeting | null> {
  return fetchMeetingById(meetingId, signal);
}
