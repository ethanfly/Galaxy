import { useEffect, useRef } from "react";

export function Modal({
  title,
  onClose,
  children,
  width,
  className = "",
}: {
  title?: React.ReactNode;
  onClose: () => void;
  children: React.ReactNode;
  width?: number | string;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey, true);
    // Focus trap entry point.
    const first = ref.current?.querySelector<HTMLElement>("input, button");
    first?.focus();
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onClose]);

  return (
    <div className="overlay-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div
        ref={ref}
        className={`modal ${className}`}
        style={width ? { width } : undefined}
        role="dialog"
        aria-modal="true"
      >
        {title != null && (
          <div className="modal-header">
            <div style={{ flex: 1 }}>{title}</div>
            <button className="icon-btn" aria-label="关闭" onClick={onClose}>✕</button>
          </div>
        )}
        {children}
      </div>
    </div>
  );
}
