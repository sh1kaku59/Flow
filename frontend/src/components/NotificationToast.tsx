import { useEffect } from "react";
import "./NotificationToast.css"

interface Props {
  message: string;
  type: "success" | "error";
  onClose: () => void;
}

export default function NotificationToast({ message, type, onClose }: Props) {
  useEffect(() => {
    const timer = setTimeout(onClose, 3000);
    return () => clearTimeout(timer);
  }, [onClose]);

  return (
    <div
      className={`
        toast
        fixed top-5 right-5 z-[9999]
        px-5 py-4 rounded-xl
        shadow-xl
        text-sm font-semibold
        flex items-center gap-3
        backdrop-blur-md
  
        transition-all duration-300 ease-out
  
        ${type === "success"
          ? "toast-success"
          : "toast-error"}
      `}
    >
      <span className="toast-icon">
        {type === "success" ? "✔" : "⚠"}
      </span>
  
      <span className="toast-message">{message}</span>
  
      <div className="toast-progress" />
    </div>
  );
}
