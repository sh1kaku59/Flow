import { useTranslation } from "react-i18next";

interface SummaryModalProps {
  isOpen: boolean;
  title: string;
  summary: string;
  loading?: boolean;
  error?: string;
  onClose: () => void;
}

function toSummaryLines(summary: string): string[] {
  const normalized = String(summary || "").replace(/\r/g, "").trim();
  if (!normalized) {
    return [];
  }

  const byLine = normalized
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  if (byLine.length > 1) {
    return byLine;
  }

  return normalized
    .split(/[.!?]\s+/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

export function SummaryModal({
  isOpen,
  title,
  summary,
  loading = false,
  error = "",
  onClose,
}: SummaryModalProps) {
  const { t } = useTranslation();
  if (!isOpen) {
    return null;
  }

  const lines = toSummaryLines(summary);

  return (
    <div
      className="fixed inset-0 z-[1200] flex items-center justify-center bg-black/40 backdrop-blur-sm px-4 py-6"
      onClick={onClose}
      role="presentation"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={t("summary")}
        className="max-h-[90vh] w-full max-w-[900px] overflow-hidden rounded-[12px] bg-[var(--modal-bg)] text-[var(--modal-text)] p-6 shadow-[0_14px_38px_rgba(0,0,0,0.18)]"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="mb-5 flex items-center justify-between">
          <h2 className="text-[38px] font-bold leading-none text-[var(--modal-text)]">{t("summary")}</h2>
          <button
            type="button"
            onClick={onClose}
            className="flex h-10 w-10 items-center justify-center rounded-full text-[32px] font-semibold leading-none transition-colors text-[var(--text-secondary)] hover:bg-[var(--bg-section)]"
            aria-label="Close summary modal"
          >
            x
          </button>
        </div>

        <div className="max-h-[68vh] overflow-y-auto pr-2">
          <h3 className="mb-3 text-[24px] font-bold text-[var(--text-primary)]">{title}</h3>

          {loading ? (
            <p className="text-[18px] font-semibold text-[var(--text-secondary)]">{t("generating_summary")}</p>
          ) : error ? (
            <p className="text-[17px] font-semibold text-[var(--text-secondary)]">{error}</p>
          ) : lines.length ? (
            <div className="space-y-3">
              {lines.map((line, index) => (
                <div key={`${line}-${index}`} className="flex items-start gap-3">
                  <span className="pt-[3px] text-[18px] font-bold text-[var(--text-primary)]">*</span>
                  <p className="text-[18px] leading-[1.55] text-[var(--text-secondary)]">{line}</p>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-[17px] font-semibold text-[var(--text-muted)]">{t("no_summary_available")}</p>
          )}
        </div>
      </div>
    </div>
  );
}


