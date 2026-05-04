import { useTranslation } from "react-i18next";
import { Meeting, MeetingStatus } from "../types";
import { formatDate, formatDuration } from "../utils";

interface DiaryCardProps {
  meeting: Meeting;
  onRename: (meeting: Meeting) => void;
  onOpenDetail: (meetingId: string) => void;
}

const STATUS_STYLES: Record<
  MeetingStatus,
  {
    cardBackground: string;
    text: string;
  }
> = {
  Pending: {
    cardBackground:
      "bg-[linear-gradient(114deg,#ab8af5_0%,#a12ef3_48%,#861fdd_100%)]",
    text: "text-[#ffffff]",
  },
  Processing: {
    cardBackground:
      "bg-[linear-gradient(112deg,#7fb9e7_0%,#3697d4_55%,#14b1e0_100%)]",
    text: "text-[#ffffff]",
  },
  Completed: {
    cardBackground:
      "bg-[linear-gradient(112deg,#40d856_0%,#30c14b_55%,#28b544_100%)]",
    text: "text-[#ffffff]",
  },
  Failed: {
    cardBackground:
      "bg-[linear-gradient(112deg,#ef967f_0%,#ef8579_58%,#ee8174_100%)]",
    text: "text-[#ffffff]",
  },
};

export function DiaryCard({ meeting, onRename, onOpenDetail }: DiaryCardProps) {
  const { t } = useTranslation();
  const style = STATUS_STYLES[meeting.status];

  const STATUS_LABELS: Record<MeetingStatus, string> = {
    Pending: t("pending"),
    Processing: t("processing"),
    Completed: t("completed"),
    Failed: t("failed"),
  };

  return (
    <article
      role="button"
      tabIndex={0}
      onClick={() => onOpenDetail(meeting.id)}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onOpenDetail(meeting.id);
        }
      }}
      className={`relative h-[160px] cursor-pointer overflow-hidden rounded-[20px] px-[35px] py-[25px]
        shadow-[0_6px_18px_rgba(0,0,0,0.15)]
        transition-all duration-200 will-change-transform
        hover:scale-[1.02]
        hover:shadow-[0_12px_28px_rgba(0,0,0,0.22)]
        active:scale-[0.99]
        ${style.cardBackground} ${style.text}`
      }
    >
      <div className="relative z-10 h-full px-[10px]">
        <div>
          <div className="flex items-center gap-[6px]">
            <h3 className="text-[28px] font-medium tracking-[0.2px] leading-none">
              {meeting.title}
            </h3>
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                onRename(meeting);
              }}
              className="text-[#474747] transition-opacity hover:opacity-100"
              aria-label={`Rename ${meeting.title}`}
            >
              <img
                src="/icons/ic_round-drive-file-rename-outline.svg"
                alt=""
                aria-hidden="true"
                className="mt-[10px] h-[19px] w-[19px] object-contain opacity-95"
              />
            </button>
          </div>
          {meeting.topic && (
              <span className="mt-[15px] inline-block rounded-full bg-white/15 px-[10px] py-[4px] text-[13px] font-medium text-white/90 backdrop-blur-md">
                {meeting.topic}
              </span>
            )}
        </div>
        <p className="absolute left-0 top-[84px] text-[20px] leading-none opacity-95 px-[10px]">
          {formatDuration(meeting.duration)}
        </p>

        <div className="absolute right-0 top-[50px] text-right px-[10px]">
          <p className="text-[20px] font-semibold leading-none">{STATUS_LABELS[meeting.status]}</p>
          <p className="mt-[18px] text-[18px] opacity-90 leading-none">{formatDate(meeting.created_at)}</p>
        </div>
      </div>

      <div className="absolute -right-[75px] top-[-70px] h-[170px] w-[165px] rounded-full bg-[#ffffff38]" />
      <div className="absolute -right-[85px] top-[74px] h-[140px] w-[155px] rounded-full bg-[#ffffff2b]" />
    </article>
  );
}
