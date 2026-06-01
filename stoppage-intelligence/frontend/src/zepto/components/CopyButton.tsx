import { useState, useRef, useEffect, MouseEvent } from "react";

interface Props {
  value: string | number | null | undefined;
  label?: string;
  className?: string;
}

/**
 * Small icon-button that copies `value` to the clipboard. Shows a brief
 * "Copied" tick for 1.5s. Stops click propagation so it can sit inside a
 * clickable parent without triggering the parent's onClick.
 */
export function CopyButton({ value, label, className }: Props) {
  const [copied, setCopied] = useState(false);
  const timerRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (timerRef.current != null) window.clearTimeout(timerRef.current);
    };
  }, []);

  async function handleCopy(e: MouseEvent<HTMLButtonElement>) {
    e.stopPropagation();
    e.preventDefault();
    if (value == null || value === "") return;
    try {
      await navigator.clipboard.writeText(String(value));
      setCopied(true);
      if (timerRef.current != null) window.clearTimeout(timerRef.current);
      timerRef.current = window.setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard API blocked — fall back silently.
    }
  }

  if (value == null || value === "") return null;

  return (
    <button
      type="button"
      className={`copy-btn ${copied ? "is-copied" : ""} ${className ?? ""}`}
      onClick={handleCopy}
      title={label ? `Copy ${label}` : "Copy"}
      aria-label={label ? `Copy ${label}` : "Copy"}
    >
      {copied ? (
        <>
          <svg width="12" height="12" viewBox="0 0 16 16" fill="none" aria-hidden>
            <path d="M3 8.5l3 3 7-7" stroke="currentColor" strokeWidth="2"
              strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          <span className="copy-btn-text">Copied</span>
        </>
      ) : (
        <svg width="12" height="12" viewBox="0 0 16 16" fill="none" aria-hidden>
          <rect x="5" y="2" width="9" height="11" rx="1.5" stroke="currentColor" strokeWidth="1.4" />
          <path d="M11 5h-7a1.5 1.5 0 00-1.5 1.5V14a1.5 1.5 0 001.5 1.5h6A1.5 1.5 0 0011 14"
            stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
        </svg>
      )}
    </button>
  );
}
