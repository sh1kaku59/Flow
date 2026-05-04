import { ChangeEvent } from "react";
import { useTranslation } from "react-i18next";

interface SearchBarProps {
  value: string;
  onChange: (value: string) => void;
  onChartClick?: () => void;
  onSummaryClick?: () => void;
  summaryLoading?: boolean;
}

export function SearchBar({
  value,
  onChange,
  onChartClick,
  onSummaryClick,
  summaryLoading = false,
}: SearchBarProps) {
  const { t } = useTranslation();
  const handleInput = (event: ChangeEvent<HTMLInputElement>) => {
    onChange(event.target.value);
  };

  return (
    <div className="flex w-full items-center gap-[10px]">
      <div className="ai-accent-search-focus relative h-[48px] flex-1 rounded-[24px]">
        <img
          src="/icons/semantic_search.svg"
          alt=""
          aria-hidden="true"
          className="pointer-events-none absolute left-[20px] top-[8px] h-[32px] w-[32px] object-contain"
        />
        <input
          type="text"
          value={value}
          onChange={handleInput}
          className="h-[48px] w-full rounded-[24px] border border-[#8c8c8c] bg-transparent pl-[70px] pr-[18px] text-[16px] font-semibold !text-black outline-none transition-all duration-200 placeholder:text-[#6b7280] hover:border-[#7f7f7f] focus:border-[#7f95ef] focus:ring-2 focus:ring-[#d5defe] dark:!text-black dark:placeholder:text-[#6b7280]"
          placeholder={t("search_placeholder")}
        />
      </div>

      <button
        type="button"
        onClick={onChartClick}
        className="flex h-[50px] w-[160px] items-center justify-center gap-[10px] rounded-[12px] bg-gradient-to-r from-[#8c00ff] to-[#6c15ff] text-[16px] font-bold text-white shadow-[0_4px_10px_rgba(75,45,166,0.25)] transition-all duration-200 ease-out hover:-translate-y-[1px] hover:shadow-[0_6px_12px_rgba(75,45,166,0.3)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#c4b5ff]"
      >
        <img
          src="/icons/solar_chart-bold.svg"
          alt=""
          aria-hidden="true"
          className="h-[22px] w-[22px] object-contain"
        />
        {t("chart")}
      </button>

      <button
        type="button"
        onClick={onSummaryClick}
        disabled={summaryLoading}
        className="flex h-[50px] w-[160px] items-center justify-center gap-[10px] rounded-[12px] bg-gradient-to-r from-[#14b8f0] to-[#0aa9f5] text-[16px] font-bold text-white shadow-[0_4px_10px_rgba(14,153,209,0.2)] transition-all duration-200 ease-out hover:-translate-y-[1px] hover:shadow-[0_6px_12px_rgba(14,153,209,0.26)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#9de7ff]"
      >
        <img
          src="/icons/tdesign_summary.svg"
          alt=""
          aria-hidden="true"
          className="h-[22px] w-[22px] object-contain"
        />
        {summaryLoading ? t("summarizing") : t("summary")}
      </button>
    </div>
  );
}
