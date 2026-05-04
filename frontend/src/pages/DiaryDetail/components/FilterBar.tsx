import { RefObject, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { FilterType, TimestampOption } from "../types";
import { ChevronDownIcon, FilterIcon, SearchIcon, SpeakerBadgeIcon } from "./icons";

interface FilterBarProps {
  filterType: FilterType;
  onFilterTypeChange: (value: FilterType) => void;
  contentKeyword: string;
  onContentKeywordChange: (value: string) => void;
  speakerId: string;
  speakerOptions: Array<{ id: string; name: string }>;
  onSpeakerChange: (speakerId: string) => void;
  timestampRange: string;
  timestampOptions: TimestampOption[];
  onTimestampChange: (value: string) => void;
}

// const FILTER_OPTIONS: FilterType[] = ["Content", "Speaker", "Timestamp"];
const ALL_OPTION = "ALL";

function useOutsideClick(ref: RefObject<HTMLDivElement>, onOutside: () => void) {
  useEffect(() => {
    const handler = (event: MouseEvent) => {
      const node = ref.current;
      if (!node || node.contains(event.target as Node)) {
        return;
      }
      onOutside();
    };

    window.addEventListener("mousedown", handler);
    return () => {
      window.removeEventListener("mousedown", handler);
    };
  }, [ref, onOutside]);
}

export function FilterBar({
  filterType,
  onFilterTypeChange,
  contentKeyword,
  onContentKeywordChange,
  speakerId,
  speakerOptions,
  onSpeakerChange,
  timestampRange,
  timestampOptions,
  onTimestampChange,
}: FilterBarProps) {
  const { t } = useTranslation();
  const [showFilterDropdown, setShowFilterDropdown] = useState(false);
  const [showDynamicDropdown, setShowDynamicDropdown] = useState(false);

  const filterDropdownRef = useRef<HTMLDivElement>(null);
  const dynamicDropdownRef = useRef<HTMLDivElement>(null);

  useOutsideClick(filterDropdownRef, () => setShowFilterDropdown(false));
  useOutsideClick(dynamicDropdownRef, () => setShowDynamicDropdown(false));

  const FILTER_OPTIONS: FilterType[] = ["Content", "Speaker", "Timestamp"];
  const FILTER_LABELS: Record<FilterType, string> = {
    Content: t("content"),
    Speaker: t("speaker"),
    Timestamp: t("timestamp"),
  };

  const rightPlaceholder =
    filterType === "Content"
      ? t("search_keywords")
      : filterType === "Speaker"
        ? t("who_find")
        : t("when_find");

  return (
    <div className="flex w-full max-w-[1370px] flex-col md:flex-row items-center md:justify-end gap-2">
      <div ref={filterDropdownRef} className="relative w-full md:w-[180px]">
        <button
          type="button"
          onClick={() => setShowFilterDropdown((prev) => !prev)}
          className="flex h-[40px] w-full items-center gap-[10px] rounded-[20px] border border-[#c8c8c8] bg-[#efefef] px-[16px] text-[16px] font-semibold text-[#777] transition-all duration-200 hover:border-[#b9b9b9] hover:bg-[#f2f2f2] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#a2b5ff]/55"
        >
          <FilterIcon className="h-[17px] w-[17px]" />
          <span>{FILTER_LABELS[filterType]}</span>
          <ChevronDownIcon className="ml-auto h-[14px] w-[14px]" />
        </button>

        {showFilterDropdown ? (
          <div className="absolute left-0 top-[46px] z-20 w-full md:w-[182px] overflow-hidden rounded-[12px] border border-[#d8d8d8] bg-[#f4f4f4] shadow-[0_8px_16px_rgba(0,0,0,0.18)]">
            {FILTER_OPTIONS.map((option) => (
              <button
                key={option}
                type="button"
                onClick={() => {
                  onFilterTypeChange(option);
                  setShowFilterDropdown(false);
                  setShowDynamicDropdown(false);
                }}
                className={`flex h-[42px] w-full items-center px-[16px] text-left text-[15px] font-semibold transition-colors ${
                  option === filterType
                    ? "bg-[#b7b7b7] text-[#fff]"
                    : "text-[#666] hover:bg-[#e4e4e4]"
                }`}
              >
                {FILTER_LABELS[option]}
              </button>
            ))}
          </div>
        ) : null}
      </div>

      <div
        ref={dynamicDropdownRef}
        className={`relative w-full ${filterType === "Content" ? "md:w-[590px]" : "md:w-[528px]"}`}
      >
        {filterType === "Content" ? (
          <div className="relative">
            <SearchIcon className="pointer-events-none absolute left-[16px] top-1/2 z-10 h-[20px] w-[20px] -translate-y-1/2 text-[#818181]" />
            <input
              type="text"
              value={contentKeyword}
              onChange={(event) => onContentKeywordChange(event.target.value)}
              className="h-[40px] w-full rounded-[20px] border border-[#989898] bg-[#efefef] pl-[54px] pr-[16px] text-[16px] font-semibold text-[#666] outline-none transition-all duration-200 placeholder:text-[#8d8d8d] hover:border-[#888] focus:border-[#8f62ff] focus:ring-2 focus:ring-[#d3dcff]"
              placeholder={rightPlaceholder}
            />
          </div>
        ) : (
          <>
            <button
              type="button"
              onClick={() => setShowDynamicDropdown((prev) => !prev)}
              className="relative flex h-[40px] w-full md:w-[590px] items-center rounded-[20px] border border-[#989898] bg-[#efefef] pl-[54px] pr-[16px] text-left text-[16px] font-semibold text-[#888] transition-all duration-200 hover:border-[#888] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#d3dcff]"
            >
              {filterType === "Speaker" ? (
                <img
                  src="/icons/lsicon_user-all-filled.svg"
                  alt=""
                  aria-hidden="true"
                  className="pointer-events-none absolute left-[16px] top-[10px] h-[20px] w-[20px] object-contain"
                />
              ) : (
                <img
                  src="/icons/ion_time.svg"
                  alt=""
                  aria-hidden="true"
                  className="pointer-events-none absolute left-[16px] top-[10px] h-[20px] w-[20px] object-contain"
                />
              )}

              <span className={`truncate ${speakerId || timestampRange ? "text-[#666]" : ""}`}>
                {filterType === "Speaker"
                  ? (speakerId && speakerId !== ALL_OPTION
                    ? speakerOptions.find((speaker) => speaker.id === speakerId)?.name
                    : "") || rightPlaceholder
                  : (timestampRange && timestampRange !== ALL_OPTION
                    ? timestampRange
                    : rightPlaceholder)}
              </span>
              <ChevronDownIcon className="ml-auto h-[14px] w-[14px] text-[#7f7f7f]" />
            </button>

            {showDynamicDropdown ? (
              <div className="absolute left-0 top-[46px] z-20 max-h-[228px] w-full overflow-y-auto rounded-[12px] border border-[#d8d8d8] bg-[#f4f4f4] py-[6px] shadow-[0_8px_16px_rgba(0,0,0,0.18)]">
                {filterType === "Speaker"
                  ? [{ id: ALL_OPTION, name: t("all") }, ...speakerOptions].map((speaker) => (
                    <button
                      key={speaker.id}
                      type="button"
                      onClick={() => {
                        onSpeakerChange(speaker.id);
                        setShowDynamicDropdown(false);
                      }}
                      className="flex h-[40px] w-full items-center gap-[10px] px-[16px] text-[15px] font-semibold text-[#676767] transition-colors hover:bg-[#e4e4e4]"
                    >
                      {speaker.name === ALL_OPTION ? (
                        <span className="flex h-[16px] w-[16px] items-center justify-center rounded-full border border-[#acacac] bg-[#ededed]">
                          <span className="h-[5px] w-[5px] rounded-full bg-[#8e8e8e]" />
                        </span>
                      ) : (
                        <span
                          className={`flex h-[16px] w-[16px] items-center justify-center rounded-full ${
                            speaker.name === "John"
                              ? "bg-[#000]"
                              : speaker.name === "Jane"
                                ? "bg-[#8b10ff]"
                                : "bg-[#13b9ef]"
                          }`}
                        >
                          <SpeakerBadgeIcon className="h-[11px] w-[11px] text-white" />
                        </span>
                      )}
                      {speaker.name}
                    </button>
                  ))
                  : (
                    <>
                      <button
                        type="button"
                        onClick={() => {
                          onTimestampChange(ALL_OPTION);
                          setShowDynamicDropdown(false);
                        }}
                        className="flex h-[40px] w-full items-center justify-center px-[16px] text-center text-[15px] font-semibold text-[#676767] transition-colors hover:bg-[#e4e4e4]"
                      >
                        {t("all")}
                      </button>
                      {timestampOptions.map((option) => (
                        <button
                          key={option.label}
                          type="button"
                          onClick={() => {
                            onTimestampChange(option.label);
                            setShowDynamicDropdown(false);
                          }}
                          className="flex h-[40px] w-full items-center justify-center px-[16px] text-center text-[15px] font-semibold text-[#676767] transition-colors hover:bg-[#e4e4e4]"
                        >
                          {option.label}
                        </button>
                      ))}
                    </>
                  )}
              </div>
            ) : null}
          </>
        )}
      </div>
    </div>
  );
}
