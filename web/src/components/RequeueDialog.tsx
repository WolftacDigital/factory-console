import { useRef, useState } from "react";
import { announce, MIN_REASON, postAction } from "../actions";
import type { ActionsStatus, Card } from "../types";
import { ConfirmDialog } from "./ConfirmDialog";

interface DialogProps {
  card: Pick<Card, "identifier" | "title">;
  from: string;
  onConfirm: (reason: string) => void;
  onCancel: () => void;
}

export function RequeueDialog({ card, from, onConfirm, onCancel }: DialogProps) {
  const [reason, setReason] = useState("");
  const [tried, setTried] = useState(false);
  const short = reason.trim().length < MIN_REASON;
  const fieldId = `reason-${card.identifier}`;
  return (
    <ConfirmDialog
      title={`Requeue ${card.identifier}`}
      confirmLabel="Confirm"
      onCancel={onCancel}
      onConfirm={() => {
        if (short) setTried(true);
        else onConfirm(reason.trim());
      }}
    >
      <p>Requeue {card.identifier} · {card.title}. Moves the issue from {from} to Todo and adds a comment with your reason.</p>
      <label className="reason-label" htmlFor={fieldId}>Reason (at least {MIN_REASON} characters)</label>
      <textarea
        id={fieldId}
        className="reason-field"
        rows={3}
        maxLength={1000}
        value={reason}
        aria-invalid={tried && short}
        aria-describedby={tried && short ? `${fieldId}-err` : undefined}
        onChange={(e) => setReason(e.target.value)}
      />
      {tried && short && <p className="reason-error" id={`${fieldId}-err`} role="alert">Enter a reason of at least {MIN_REASON} characters.</p>}
    </ConfirmDialog>
  );
}

interface ActionProps {
  card: Card;
  from: string;
  linear: ActionsStatus["linear"] | undefined;
  dryRun: boolean;
}

export function RequeueAction({ card, from, linear, dryRun }: ActionProps) {
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ cls: string; text: string } | null>(null);
  const button = useRef<HTMLButtonElement>(null);
  const available = !!linear?.available;
  const disabled = !available || busy;
  const whyId = `requeue-why-${card.identifier}`;

  const close = () => {
    setAsking(false);
    setTimeout(() => button.current?.focus(), 0);
  };
  const confirm = async (reason: string) => {
    close();
    setBusy(true);
    setResult(null);
    const res = await postAction(`/api/actions/issue/${encodeURIComponent(card.identifier)}/requeue`, { reason });
    setBusy(false);
    const text = res.warning ?? res.message ?? res.error ?? (res.ok ? "Done" : "Requeue failed");
    setResult({ cls: res.warning ? "warn" : res.ok ? "ok" : "bad", text });
    announce(`${card.identifier}: ${text}`);
  };

  return (
    <div className="requeue">
      <button
        ref={button}
        type="button"
        className={`ctl small${busy ? " busy" : ""}`}
        aria-disabled={disabled}
        aria-busy={busy}
        aria-describedby={!available ? whyId : undefined}
        aria-label={`Requeue ${card.identifier}`}
        onClick={() => {
          if (!disabled) setAsking(true);
        }}
      >
        {busy && <span className="spinner" aria-hidden="true" />}
        Requeue{dryRun ? " (dry run)" : ""}
      </button>
      {!available && <span className="control-why" id={whyId}>{linear?.reason ?? "Linear not connected"}</span>}
      {result && <p className={`control-result ${result.cls}`}>{result.text}</p>}
      {asking && <RequeueDialog card={card} from={from} onConfirm={confirm} onCancel={close} />}
    </div>
  );
}
