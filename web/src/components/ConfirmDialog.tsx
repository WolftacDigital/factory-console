import { useEffect, useRef, type ReactNode } from "react";

interface Props {
  title: string;
  children: ReactNode;
  confirmLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
}

/**
 * Modal confirmation: traps focus, starts on Cancel, closes on Esc.
 * Its key handler runs in the capture phase so Esc and Tab never reach the drawer underneath.
 */
export function ConfirmDialog({ title, children, confirmLabel = "Confirm", onConfirm, onCancel }: Props) {
  const box = useRef<HTMLDivElement>(null);
  const cancel = useRef<HTMLButtonElement>(null);
  const cancelFn = useRef(onCancel);
  cancelFn.current = onCancel;

  useEffect(() => {
    cancel.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopImmediatePropagation();
        cancelFn.current();
      } else if (e.key === "Tab" && box.current) {
        e.stopImmediatePropagation();
        const f = box.current.querySelectorAll<HTMLElement>("button, input, textarea, a[href]");
        if (!f.length) return;
        const first = f[0], last = f[f.length - 1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, []);

  return (
    <div className="confirm-layer">
      <div className="confirm-scrim" onClick={onCancel} aria-hidden="true" />
      <div className="confirm" ref={box} role="alertdialog" aria-modal="true" aria-labelledby="confirm-h" aria-describedby="confirm-body">
        <h2 id="confirm-h">{title}</h2>
        <div id="confirm-body">{children}</div>
        <div className="confirm-actions">
          <button ref={cancel} type="button" className="ctl" onClick={onCancel}>Cancel</button>
          <button type="button" className="ctl primary" onClick={onConfirm}>{confirmLabel}</button>
        </div>
      </div>
    </div>
  );
}
