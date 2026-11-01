import { useRef, useState } from "react";
import { announce, confirmText, postAction, VERB_LABEL } from "../actions";
import type { ActionVerb, StationView } from "../types";
import { ConfirmDialog } from "./ConfirmDialog";

const VERBS: ActionVerb[] = ["pause", "resume", "run"];

export function Controls({ station, dryRun }: { station: StationView; dryRun: boolean }) {
  const [asking, setAsking] = useState<ActionVerb | null>(null);
  const [busy, setBusy] = useState<ActionVerb | null>(null);
  const [result, setResult] = useState<{ ok: boolean; text: string; backup?: string | null } | null>(null);
  const buttons = useRef<Partial<Record<ActionVerb, HTMLButtonElement | null>>>({});
  const controls = station.controls;
  if (!controls) return null;

  const closeDialog = (verb: ActionVerb) => {
    setAsking(null);
    setTimeout(() => buttons.current[verb]?.focus(), 0);
  };

  const confirm = async (verb: ActionVerb) => {
    closeDialog(verb);
    setBusy(verb);
    setResult(null);
    const res = await postAction(`/api/actions/station/${encodeURIComponent(station.key)}/${verb}`);
    setBusy(null);
    const text = res.ok ? res.message ?? "Done" : res.error ?? "Action failed";
    setResult({ ok: res.ok, text, backup: res.backup });
    announce(`${station.name}: ${text}`);
  };

  const dialog = asking ? confirmText(station, asking) : null;
  return (
    <section className="controls" aria-labelledby={`controls-${station.key}`}>
      <h3 className="label" id={`controls-${station.key}`}>Controls{dryRun ? " · dry run, nothing will change" : ""}</h3>
      <div className="control-row">
        {VERBS.map((verb) => {
          const c = controls[verb];
          const disabled = !c.enabled || busy !== null;
          return (
            <div className="control" key={verb}>
              <button
                ref={(el) => {
                  buttons.current[verb] = el;
                }}
                type="button"
                className={`ctl${busy === verb ? " busy" : ""}`}
                aria-disabled={disabled}
                aria-busy={busy === verb}
                aria-describedby={c.reason ? `why-${station.key}-${verb}` : undefined}
                onClick={() => {
                  if (!disabled) setAsking(verb);
                }}
              >
                {busy === verb && <span className="spinner" aria-hidden="true" />}
                {VERB_LABEL[verb]}
              </button>
              {!c.enabled && c.reason && <span className="control-why" id={`why-${station.key}-${verb}`}>{c.reason}</span>}
            </div>
          );
        })}
      </div>
      {result && (
        <p className={`control-result ${result.ok ? "ok" : "bad"}`}>
          {result.text}
          {result.backup ? <span className="data control-backup">{result.backup}</span> : null}
        </p>
      )}
      {asking && dialog && (
        <ConfirmDialog title={dialog.title} onConfirm={() => confirm(asking)} onCancel={() => closeDialog(asking)}>
          <p>{dialog.body}</p>
        </ConfirmDialog>
      )}
    </section>
  );
}
