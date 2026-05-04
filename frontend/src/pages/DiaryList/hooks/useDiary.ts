import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { fetchMeetings, patchMeetingTitle, searchMeetingsSemantic } from "../../../services/DiaryService";
import { Meeting, SortOption } from "../types";

const DEFAULT_PAGE_SIZE = 4;

function normalize(value: string): string {
  return value.trim().toLowerCase();
}

function rankBySemantic(meetings: Meeting[], rankedIds: string[]): Meeting[] {
  const byId = new Map(meetings.map((meeting) => [meeting.id, meeting]));
  const matched = rankedIds
    .map((id) => byId.get(id))
    .filter((meeting): meeting is Meeting => Boolean(meeting));

  const seen = new Set(matched.map((meeting) => meeting.id));
  const rest = meetings.filter((meeting) => !seen.has(meeting.id));
  return [...matched, ...rest];
}

function compareText(a: string, b: string): number {
  return a.localeCompare(b, undefined, { sensitivity: "base" });
}

function sortMeetings(meetings: Meeting[], sortOption: SortOption): Meeting[] {
  const source = [...meetings];

  source.sort((left, right) => {
    switch (sortOption) {
      case "Most Recent":
        return (
          new Date(right.created_at).getTime() - new Date(left.created_at).getTime()
        );
      case "Oldest":
        return (
          new Date(left.created_at).getTime() - new Date(right.created_at).getTime()
        );
      case "A -> Z":
        return compareText(left.title, right.title);
      case "Z -> A":
        return compareText(right.title, left.title);
      case "Duration":
        return (right.duration ?? -1) - (left.duration ?? -1);
      default:
        return 0;
    }
  });

  return source;
}

function keepOwnedMeetings(meetings: Meeting[], currentUserId?: string): Meeting[] {
  if (!currentUserId) {
    return meetings;
  }

  return meetings.filter((meeting) => {
    if (!meeting.account_id) {
      return true;
    }
    return meeting.account_id === currentUserId;
  });
}

export interface UseDiaryOptions {
  pageSize?: number;
  currentUserId?: string;
}

export function useDiary(options: UseDiaryOptions = {}) {
  const { t } = useTranslation();
  const pageSize = options.pageSize ?? DEFAULT_PAGE_SIZE;

  const [meetings, setMeetings] = useState<Meeting[]>([]);
  const [searchKeyword, setSearchKeyword] = useState("");
  const [semanticMeetingIds, setSemanticMeetingIds] = useState<string[] | null>(null);
  const [semanticReady, setSemanticReady] = useState(false);
  const [sortOption, setSortOption] = useState<SortOption>("Most Recent");
  const [currentPage, setCurrentPage] = useState(1);

  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");

  const loadMeetings = useCallback(
    async (refresh = false, signal?: AbortSignal) => {
      if (refresh) {
        setIsRefreshing(true);
      } else {
        setIsLoading(true);
      }
      setErrorMessage("");

      try {
        const data = await fetchMeetings(signal);
        setMeetings(keepOwnedMeetings(data, options.currentUserId));
      } catch (error) {
        if (error instanceof Error && error.name === "AbortError") {
          return;
        }
        setErrorMessage(
          error instanceof Error
            ? error.message
            : t("unable_retrieve_diary")
        );
      } finally {
        if (refresh) {
          setIsRefreshing(false);
        } else {
          setIsLoading(false);
        }
      }
    },
    [options.currentUserId, t]
  );

  useEffect(() => {
    const controller = new AbortController();
    void loadMeetings(false, controller.signal);
    return () => controller.abort();
  }, [loadMeetings]);

  useEffect(() => {
    const keyword = searchKeyword.trim();
    if (!keyword) {
      setSemanticMeetingIds(null);
      setSemanticReady(false);
      return;
    }

    const controller = new AbortController();
    const timeout = window.setTimeout(() => {
      setSemanticReady(false);
      searchMeetingsSemantic(keyword, controller.signal)
        .then((items) => {
          setSemanticMeetingIds(items.map((item) => item.meetingId));
          setSemanticReady(true);
        })
        .catch((error) => {
          if (error instanceof Error && error.name === "AbortError") {
            return;
          }
          // Semantic-only mode: if semantic request fails, return empty result.
          setSemanticMeetingIds([]);
          setSemanticReady(true);
        });
    }, 280);

    return () => {
      window.clearTimeout(timeout);
      controller.abort();
    };
  }, [searchKeyword]);

  const filteredMeetings = useMemo(() => {
    const keyword = normalize(searchKeyword);

    if (!keyword) {
      return sortMeetings(meetings, sortOption);
    }

    if (!semanticReady) {
      return [];
    }

    if (semanticReady) {
      const rankedIds = semanticMeetingIds ?? [];
      const matched = meetings.filter((meeting) => rankedIds.includes(meeting.id));
      return rankBySemantic(matched, rankedIds);
    }
    return [];
  }, [meetings, searchKeyword, semanticMeetingIds, semanticReady, sortOption]);

  const totalItems = filteredMeetings.length;
  const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));

  useEffect(() => {
    if (currentPage > totalPages) {
      setCurrentPage(totalPages);
    }
  }, [currentPage, totalPages]);

  const pagedMeetings = useMemo(() => {
    const start = (currentPage - 1) * pageSize;
    return filteredMeetings.slice(start, start + pageSize);
  }, [currentPage, filteredMeetings, pageSize]);

  const renameMeeting = useCallback(
    async (meetingId: string, nextTitle: string) => {
      const title = nextTitle.trim();
      let previousTitle = "";

      setMeetings((previous) =>
        previous.map((meeting) => {
          if (meeting.id !== meetingId) {
            return meeting;
          }
          previousTitle = meeting.title;
          return { ...meeting, title };
        })
      );

      try {
        await patchMeetingTitle(meetingId, title);
      } catch (error) {
        setMeetings((previous) =>
          previous.map((meeting) =>
            meeting.id === meetingId ? { ...meeting, title: previousTitle } : meeting
          )
        );
        throw error;
      }
    },
    []
  );

  const refresh = useCallback(async () => {
    await loadMeetings(true);
  }, [loadMeetings]);

  return {
    meetings: pagedMeetings,
    allMeetings: meetings,
    isLoading,
    isRefreshing,
    errorMessage,
    searchKeyword,
    sortOption,
    currentPage,
    totalPages,
    totalItems,
    hasResult: totalItems > 0,
    setSearchKeyword: (value: string) => {
      setSearchKeyword(value);
      setCurrentPage(1);
    },
    setSortOption: (value: SortOption) => {
      setSortOption(value);
      setCurrentPage(1);
    },
    setCurrentPage,
    refresh,
    renameMeeting,
  };
}

