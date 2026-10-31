import type { Status } from "../types";

// Status is always a text label; color is only reinforcement.
export function StatusChip({ status }: { status: Status }) {
  return <span className={`chip ${status.replace(" ", "_")}`}>{status}</span>;
}
