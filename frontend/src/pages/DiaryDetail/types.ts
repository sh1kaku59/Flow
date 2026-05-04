export interface TranscriptSegment {
  id: string;
  meeting_id: string;
  speaker_id: string;
  content: string;
  start_time: number;
  end_time: number;
}

export interface Speaker {
  id: string;
  speakers_name: string;
  avatar_url: string;
  is_identified: boolean;
}

export type MeetingStatus = "Pending" | "Processing" | "Completed" | "Failed";

export interface Meeting {
  id: string;
  title: string;
  topic?: string;
  status?: MeetingStatus;
  created_at?: string;
  audio_url: string;
  duration?: number;
  account_id?: string;
}

export interface DiaryDetailData {
  meeting: Meeting;
  speakers: Speaker[];
  transcriptSegments: TranscriptSegment[];
}

export type FilterType = "Content" | "Speaker" | "Timestamp";

export interface TimestampOption {
  label: string;
  start: number;
  end: number;
}
