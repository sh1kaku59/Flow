import { FormEvent, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

interface RenameModalProps {
  isOpen: boolean;
  initialTitle: string;
  blockedTitles: string[];
  isSaving: boolean;
  onCancel: () => void;
  onConfirm: (nextTitle: string) => Promise<void>;
}

function hasUnsupportedControlChars(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const codePoint = value.charCodeAt(index);
    if ((codePoint >= 0 && codePoint <= 31) || codePoint === 127) {
      return true;
    }
  }
  return false;
}

export function RenameModal({
  isOpen,
  initialTitle,
  blockedTitles,
  isSaving,
  onCancel,
  onConfirm,
}: RenameModalProps) {
  const { t } = useTranslation();
  const [title, setTitle] = useState(initialTitle);

  useEffect(() => {
    if (!isOpen) {
      return;
    }
    setTitle(initialTitle);
  }, [initialTitle, isOpen]);

  const validationError = useMemo(() => {
    const value = title.trim();
    const initial = initialTitle.trim();

    if (value.length === 0) {
      return t("title_required");
    }

    if (value.length > 120) {
      return t("title_too_long");
    }

    if (hasUnsupportedControlChars(value)) {
      return t("title_unsupported_chars");
    }

    const normalized = value.toLowerCase();
    const hasDuplicate = blockedTitles.some(
      (bt) => bt.trim().toLowerCase() === normalized && bt.trim().toLowerCase() !== initial.toLowerCase()
    );
    if (hasDuplicate) {
      return t("title_exists");
    }

    return "";
  }, [blockedTitles, initialTitle, title, t]);
  const isPristine = title.trim() === initialTitle.trim();
  const disableSubmit = isSaving || isPristine || validationError !== "";

  if (!isOpen) {
    return null;
  }

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (disableSubmit) {
      return;
    }
    await onConfirm(title.trim());
  };

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
  <form
    onSubmit={onSubmit}
    className="w-full max-w-[720px] rounded-[20px] bg-[var(--modal-bg)] px-10 py-8 shadow-[0_20px_60px_rgba(0,0,0,0.25)]"
  >
    {/* Title */}
    <h2 className="text-[28px] font-semibold text-[var(--modal-text)]">{t("diary")}</h2>

    {/* Input */}    
    <div className="mt-8 relative">
      {/* Label */}
      <label className="
        absolute -top-[10px] left-[14px]
        bg-[var(--modal-bg)] px-[6px]
        text-[13px] text-[var(--text-muted)]
        z-10
      ">
        {t("title")}
      </label>

      {/* Input wrapper */}
      <div className="relative">
      <input
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        className="
          w-full h-[48px] px-3 pt-3 pb-2 text-[18px]
          bg-[var(--input-bg)] text-[var(--modal-text)]
          outline-none
          border border-[var(--input-border)]
          rounded-[10px]
          hover:border-[var(--input-border-hover)]
          focus:border-transparent
          transition-all duration-200
          peer
        "
      />

        {/* Bottom border khi focus */}
        <span
          className="
            pointer-events-none absolute left-0 bottom-0 h-[2px] w-0
            bg-[var(--btn-primary)]
            transition-all duration-200
            peer-focus:w-full
          "
        />
      </div>
    </div>

    {/* Buttons */}
    <div className="mt-10 flex justify-end gap-4">
      {/* Cancel */}
      <button
        type="button"
        onClick={onCancel}
        className="
          h-[44px] px-6 rounded-[12px]
          border border-[var(--btn-cancel-border)]
          text-[16px] font-medium
          text-[var(--modal-text)]
          transition-all duration-200
          hover:bg-[var(--btn-cancel-hover)]
        "
      >
        {t("cancel")}
      </button>

      {/* Save */}
      <button
        type="submit"
        disabled={disableSubmit}
        className={`h-[44px] px-6 rounded-[12px] text-[16px] font-semibold transition-all duration-200
        ${
          disableSubmit
            ? "bg-[var(--btn-disabled)] text-[var(--text-muted)] cursor-not-allowed"
            : "bg-[var(--btn-primary)] text-[var(--modal-bg)] hover:bg-[var(--btn-primary-hover)] active:scale-[0.98]"
        }`}
      >
        {t("save_changes")}
      </button>
    </div>
  </form>
</div>
  );
}
