"use client";

import { useState } from "react";
import { PAGES, type StepView, type TOOLS, type ViewId } from "@/lib/steps";
import type { AppStatus } from "@/lib/types";

type Tool = (typeof TOOLS)[number];

const MARK: Record<StepView["state"], string> = { done: "✓", open: "○", locked: "🔒" };

/**
 * The steps for the current kit type, its tools, and the pages every pack
 * shares. On a narrow screen it folds into a top bar with a menu.
 */
export function StepDrawer({
  views,
  tools,
  current,
  onGo,
  onNewPack,
  status,
  packCount,
  kitLabel,
}: {
  views: StepView[];
  tools: readonly Tool[];
  current: ViewId;
  onGo: (view: ViewId) => void;
  onNewPack: () => void;
  status: AppStatus | null;
  packCount: number;
  kitLabel: string;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const go = (v: ViewId) => {
    setMenuOpen(false);
    onGo(v);
  };

  const currentLabel =
    views.find((v) => v.id === current)?.label ??
    tools.find((t) => t.id === current)?.label ??
    PAGES.find((p) => p.id === current)?.label ??
    "";

  return (
    <>
      <div className="drawer-bar">
        <button type="button" className="btn ghost small" onClick={() => setMenuOpen((o) => !o)} aria-expanded={menuOpen}>
          {menuOpen ? "Close" : "Menu"}
        </button>
        <strong style={{ fontSize: 14 }}>{currentLabel}</strong>
      </div>

      <nav className={menuOpen ? "drawer open" : "drawer"} aria-label="Steps">
        <h1>
          icon<span>maschine</span>
        </h1>
        <button type="button" className="btn secondary small" onClick={() => { setMenuOpen(false); onNewPack(); }}>
          New pack
        </button>

        <div>
          <div className="group-label">Build a pack</div>
          {views.map((v, i) => {
            const isCurrent = v.id === current;
            return (
              <button
                type="button"
                key={v.id}
                className={`drawer-item ${v.state}`}
                aria-current={isCurrent ? "step" : undefined}
                onClick={() => go(v.id)}
                title={v.state === "locked" ? "Not available yet" : undefined}
              >
                <span className="mark">{isCurrent && v.state === "open" ? "●" : MARK[v.state]}</span>
                <span>
                  {i + 1} {v.label}
                  {v.optional && <span className="opt">optional</span>}
                </span>
              </button>
            );
          })}
        </div>

        {tools.length > 0 && (
          <div>
            <div className="group-label">Tools for {kitLabel}</div>
            {tools.map((t) => (
              <button
                type="button"
                key={t.id}
                className="drawer-item"
                aria-current={t.id === current ? "page" : undefined}
                onClick={() => go(t.id)}
              >
                <span className="mark" />
                <span>{t.label}</span>
              </button>
            ))}
          </div>
        )}

        <div>
          <div className="group-label">Every pack</div>
          {PAGES.map((p) => (
            <button
              type="button"
              key={p.id}
              className="drawer-item"
              aria-current={p.id === current ? "page" : undefined}
              onClick={() => go(p.id)}
            >
              <span className="mark" />
              <span>
                {p.label}
                {p.id === "packs" && ` (${packCount})`}
              </span>
            </button>
          ))}
        </div>

        {status && (
          <div className="chips">
            <span className={status.rootWritable ? "chip ok" : "chip warn"}>
              {status.rootWritable
                ? "NI Resources writable"
                : status.rootExists
                  ? "NI Resources read-only"
                  : "NI Resources not found"}
            </span>
            <span className={status.hasOpenAiKey ? "chip ok" : "chip"}>
              {status.hasOpenAiKey ? "OpenAI key loaded" : "no OpenAI key"}
            </span>
            <span className={status.hasSerpKey ? "chip ok" : "chip"}>
              {status.hasSerpKey ? "SerpAPI key loaded" : "no SerpAPI key"}
            </span>
            <span className={status.distDbExists ? "chip ok" : "chip warn"}>
              {status.distDbExists ? "dist_database found" : "no dist_database yet"}
            </span>
          </div>
        )}
      </nav>
    </>
  );
}
