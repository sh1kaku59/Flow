import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import Header from "../../components/Header";
import { SearchIcon } from "../DiaryDetail/components/Icons";
import { DiaryCard } from "./components/DiaryCard";
import { RenameModal } from "./components/RenameModal";
import { useDiary } from "./hooks/useDiary";
import { Meeting, SortOption } from "./types";
import { RefreshCcw } from "lucide-react";

// const SORT_OPTIONS: SortOption[] = ["Most Recent", "Oldest", "A -> Z", "Z -> A", "Duration"];

interface DiaryPageProps {
  onOpenDiaryDetail?: (meetingId: string) => void;
}

function ChevronDownGlyph() {
  return (
    <svg viewBox="0 0 24 24" className="h-[14px] w-[14px]" fill="currentColor">
      <path d="M6.2 8.8L12 14.6L17.8 8.8" />
    </svg>
  );
}

function getCurrentUserId(): string | undefined {
  const fromStorage = window.localStorage.getItem("flow_account_id");
  if (fromStorage) {
    return fromStorage;
  }

  const fromEnv = import.meta.env.VITE_CURRENT_USER_ID as string | undefined;
  return fromEnv && fromEnv.trim() ? fromEnv : undefined;
}

export function DiaryPage({ onOpenDiaryDetail }: DiaryPageProps) {
  const { t } = useTranslation();
  const [sortMenuOpen, setSortMenuOpen] = useState(false);
  const [selectedMeeting, setSelectedMeeting] = useState<Meeting | null>(null);
  const [isRenaming, setIsRenaming] = useState(false);
  const [flashMessage, setFlashMessage] = useState("");

  const currentUserId = useMemo(() => getCurrentUserId(), []);

  const SORT_OPTIONS_LABELS: Record<SortOption, string> = {
    "Most Recent": t("most_recent"),
    "Oldest": t("oldest"),
    "A -> Z": t("a_z"),
    "Z -> A": t("z_a"),
    "Duration": t("duration"),
  };
  const SORT_OPTIONS: SortOption[] = ["Most Recent", "Oldest", "A -> Z", "Z -> A", "Duration"];

  const {
    meetings,
    allMeetings,
    isLoading,
    isRefreshing,
    errorMessage,
    searchKeyword,
    sortOption,
    currentPage,
    totalPages,
    totalItems,
    hasResult,
    setSearchKeyword,
    setSortOption,
    setCurrentPage,
    refresh,
    renameMeeting,
  } = useDiary({ currentUserId, pageSize: 4 });

  const blockedTitles = useMemo(() => {
    if (!selectedMeeting) {
      return [];
    }
    return allMeetings
      .filter((meeting) => meeting.id !== selectedMeeting.id)
      .map((meeting) => meeting.title);
  }, [allMeetings, selectedMeeting]);

  const pageNumbers = useMemo(() => {
    return Array.from({ length: totalPages }, (_, index) => index + 1);
  }, [totalPages]);

  const noResult = !isLoading && !errorMessage && !hasResult;

  return (
    <main className="h-screen w-full overflow-hidden bg-[var(--bg-main)] text-[var(--text-primary)]">
      <Header />

      <div className="mx-auto flex h-[calc(100vh-96px)] w-full min-h-0 px-[40px] py-[16px]">
        <section className="flex h-full w-full min-h-0 flex-col rounded-[18px] bg-[var(--bg-section)] p-[20px]">          
          <div className="mx-[50px] flex h-[50px] shrink-0 items-center rounded-[20px] border border-[var(--border-color)] bg-[var(--bg-card)] px-[16px] transition-all duration-200 hover:scale-[1.02] focus-within:ring-2 focus-within:ring-[#8f62ff]">            
          <SearchIcon className="h-[20px] w-[20px] text-[var(--text-muted)]" />
            <input
              value={searchKeyword}
              onChange={(event) => setSearchKeyword(event.target.value)}
              placeholder={t("search_placeholder")}
              className="ml-[12px] h-full w-full bg-transparent text-[16px] font-semibold text-[var(--text-secondary)] outline-none placeholder:text-[var(--text-muted)]"
            />
          </div>

          <div className="mt-[20px] flex shrink-0 items-center justify-between px-[50px]">
            <div className="flex items-center gap-[20px]">
               <h1 className="text-[20px] font-bold leading-none">{t("all_diaries")}</h1>
                <span className="text-[18px] font-semibold leading-none text-[var(--text-secondary)]">
                {totalItems}
              </span>
            </div>

            <div className="relative flex items-center gap-[12px]">
              <div className="flex items-center gap-[8px] text-[var(--text-secondary)]">
                <img
                  src="/icons/material-symbols_sort-rounded.svg"
                  alt=""
                  aria-hidden="true"
                  className="h-[25px] w-[25px] object-contain opacity-90"
                />
                <span className="text-[20px] font-semibold leading-none">{t("sort_by")}</span>
              </div>

              <div className="relative">
                <button
                  type="button"
                  onClick={() => setSortMenuOpen((prev) => !prev)}
                  className="flex h-[50px] min-w-[186px] items-center justify-between rounded-[18px] border border-[var(--border-color)] bg-[var(--bg-section)] px-[20px] text-[15px] font-semibold text-[var(--text-primary)]"
                >
                  {SORT_OPTIONS_LABELS[sortOption]}
                  <ChevronDownGlyph />
                </button>

                {sortMenuOpen ? (
                  <div className="absolute right-0 z-20 mt-[6px] w-[182px] overflow-hidden rounded-[12px] bg-[var(--bg-card)] shadow-[0_10px_20px_rgba(0,0,0,0.25)]">
                    {SORT_OPTIONS.map((option) => (
                      <button
                        key={option}
                        type="button"
                        onClick={() => {
                          setSortOption(option);
                          setSortMenuOpen(false);
                        }}
                        className={`flex h-[45px] w-full items-center px-[15px] text-left text-[15px] font-semibold ${
                          option === sortOption
                            ? "bg-[#b8b8b8] text-[#ffffff]"
                            : "text-[#686868] hover:bg-[#dfdfdf]"
                        }`}
                      >
                        {SORT_OPTIONS_LABELS[option]}
                      </button>
                    ))}
                  </div>
                ) : null}
              </div>

              <button
                type="button"
                onClick={() => void refresh()}
                className="
                  flex h-[50px] min-w-[120px] items-center justify-center
                  rounded-[20px] bg-[#10b5e6] text-white
                  transition-all duration-200
                  hover:bg-[#0ea5d6]
                  active:scale-[1.05]
                  disabled:opacity-70
                "
                aria-label="Refresh diaries"
                disabled={isRefreshing || isLoading}
              >
                <RefreshCcw
                  size={24}
                  strokeWidth={2}
                  className={`
                    transition-transform duration-500
                    ${isRefreshing ? "animate-[spin_0.8s_linear_infinite]" : ""}
                  `}
                />
              </button>
            </div>
          </div>

          <div className="mt-[10px] mb-[15px] h-[4px] shrink-0 bg-[var(--divider)]"/>

          {flashMessage ? (
            <p className="mt-[12px] text-[14px] font-semibold text-[var(--success)]">{flashMessage}</p>
          ) : null}

          {isLoading ? (
            <div className="mt-[18px] rounded-[14px] bg-[#ededed] px-[20px] py-[26px] text-[16px] font-semibold text-[#6a6a6a]">
              {t("loading_diaries")}
            </div>
          ) : null}

          {!isLoading && errorMessage ? (
            <div className="mt-[18px] rounded-[14px] bg-[#ededed] px-[20px] py-[20px]">
              <p className="text-[15px] font-semibold text-[var(--error)]">{errorMessage}</p>
              <button
                type="button"
                onClick={() => void refresh()}
                className="mt-[10px] rounded-[10px] border border-[#b6b6b6] bg-[#fff] px-[12px] py-[8px] text-[14px] font-semibold text-[#363636]"
              >
                {t("retry")}
              </button>
            </div>
          ) : null}

          {noResult ? (
            <div className="mt-[18px] rounded-[14px] bg-[var(--bg-card)] px-[20px] py-[26px] text-[16px] font-semibold text-[var(--text-secondary)]">
              {searchKeyword.trim()
                ? t("no_results_found")
                : t("no_diaries_available")}
            </div>
          ) : null}

          {!isLoading && !errorMessage && hasResult ? (
            <div className="mt-[12px] flex flex-col">
              <div className="grid grid-cols-1 gap-x-[14px] gap-y-[34px] md:grid-cols-2">
                {meetings.map((meeting) => (
                  <DiaryCard
                    key={meeting.id}
                    meeting={meeting}
                    onOpenDetail={(meetingId) => onOpenDiaryDetail?.(meetingId)}
                    onRename={(value) => {
                      setSelectedMeeting(value);
                    }}
                  />
                ))}
              </div>

              <div className="mt-[16px] flex shrink-0 items-center justify-center gap-[14px] pb-[8px]">
                <button
                  type="button"
                  onClick={() => setCurrentPage(Math.max(1, currentPage - 1))}
                  disabled={currentPage === 1}
                  className="text-[15px] font-semibold text-[#2f2f2f] disabled:opacity-40"
                >
                  {t("prev")}
                </button>

                {pageNumbers.map((page) => (
                  <button
                    key={page}
                    type="button"
                    onClick={() => setCurrentPage(page)}
                    className={`h-[38px] w-[38px] rounded-[8px] border text-[16px] font-semibold ${
                      page === currentPage
                        ? "border-[var(--text-primary)] bg-[var(--bg-card)] text-[var(--text-primary)]"
                        : "border-[var(--border-color)] text-[var(--text-secondary)]"
                    }`}
                  >
                    {page}
                  </button>
                ))}

                <button
                  type="button"
                  onClick={() => setCurrentPage(Math.min(totalPages, currentPage + 1))}
                  disabled={currentPage === totalPages}
                  className="text-[15px] font-semibold text-[var(--text-primary)] disabled:opacity-40"
                >
                  {t("next")}
                </button>
              </div>
            </div>
          ) : null}
        </section>
      </div>

      <RenameModal
        isOpen={selectedMeeting !== null}
        initialTitle={selectedMeeting?.title ?? ""}
        blockedTitles={blockedTitles}
        isSaving={isRenaming}
        onCancel={() => {
          setSelectedMeeting(null);
        }}
        onConfirm={async (nextTitle) => {
          if (!selectedMeeting) {
            return;
          }
          setIsRenaming(true);
          setFlashMessage("");
          try {
            await renameMeeting(selectedMeeting.id, nextTitle);
            setSelectedMeeting(null);
            setFlashMessage(t("diary_renamed_success"));
            window.setTimeout(() => setFlashMessage(""), 2500);
          } catch {
            // Keep modal open on failure; UI currently does not surface inline rename errors.
          } finally {
            setIsRenaming(false);
          }
        }}
      />
    </main>
  );
}

