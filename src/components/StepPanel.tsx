"use client";

import type { ReactNode } from "react";
import type { StepId, StepView } from "@/lib/steps";

/**
 * One step's content. It stays mounted while its step is open and is only
 * hidden when another step is current, so a panel's own state (search
 * results, unsaved rules, a shown plan) survives moving between steps.
 */
export function StepPanel({
  view,
  current,
  labels,
  needs,
  onGo,
  children,
}: {
  view: StepView | undefined;
  current: string;
  labels: Record<StepId, string>;
  /** What to list when the step is locked, from `blockers()`. */
  needs: StepId[];
  onGo: (id: StepId) => void;
  children: ReactNode;
}) {
  if (!view) return null;
  const isCurrent = view.id === current;

  if (view.state === "locked") {
    if (!isCurrent) return null;
    return (
      <section className="step">
        <h2>{view.label}</h2>
        <div className="note">
          This step needs:{" "}
          {needs.map((id, i) => (
            <span key={id}>
              {i > 0 && ", "}
              <button type="button" className="link-btn" onClick={() => onGo(id)}>
                {labels[id]}
              </button>
            </span>
          ))}
        </div>
      </section>
    );
  }

  return <div hidden={!isCurrent}>{children}</div>;
}
