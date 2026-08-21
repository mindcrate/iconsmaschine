"use client";

import { useState } from "react";
import { formatBytes, postJson } from "@/lib/client";
import type { InstallPlan, InstallResult } from "@/lib/types";

export function InstallPanel({ packId }: { packId: string }) {
  const [plan, setPlan] = useState<InstallPlan | null>(null);
  const [result, setResult] = useState<InstallResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run(dryRun: boolean) {
    setBusy(true);
    setError(null);
    if (dryRun) setResult(null);
    try {
      const res = await postJson<{ plan: InstallPlan; result?: InstallResult }>(
        `/api/packs/${packId}/install`,
        { dryRun },
      );
      setPlan(res.plan);
      if (res.result) setResult(res.result);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const overwrites = plan?.writes.filter((w) => w.existing).length ?? 0;
  const blocked = plan ? !plan.rootExists || !plan.rootWritable : false;

  return (
    <div>
      <div className="actions">
        <button className="btn secondary" onClick={() => run(true)} disabled={busy}>
          {busy && !plan ? <><span className="spinner" /> Checking…</> : "Check what will be written"}
        </button>
        <a className="btn ghost" href={`/api/packs/${packId}/export`}>
          Download .zip instead
        </a>
      </div>

      {error && <div className="note bad">{error}</div>}

      {plan && (
        <>
          <div className="path-preview" style={{ marginTop: 16 }}>
            {plan.root}/<b>{plan.relativeDir}</b>/
          </div>

          <div className="plan">
            {plan.writes.map((w) => (
              <div key={w.file}>
                <span className="path">{w.file}</span>
                <span className="state">{formatBytes(w.bytes)}</span>
                <span className={w.existing ? "state overwrite" : "state"}>
                  {w.existing ? "overwrites existing" : "new"}
                </span>
              </div>
            ))}
          </div>

          {plan.warnings.map((w) => (
            <div className="note bad" key={w}>
              {w}
            </div>
          ))}

          {overwrites > 0 && !result && (
            <div className="note">
              {overwrites} file{overwrites === 1 ? "" : "s"} already exist and will be
              replaced.
            </div>
          )}

          {!result && (
            <div className="actions">
              <button
                className="btn"
                onClick={() => run(false)}
                disabled={busy || blocked}
              >
                {busy ? <><span className="spinner" /> Installing…</> : "Install to NI Resources"}
              </button>
            </div>
          )}
        </>
      )}

      {result && (
        <div className="note good">
          Installed {result.written.length} files to <code>{result.targetDir}</code>.
          Restart Maschine (or rescan the browser) to see them.
        </div>
      )}
    </div>
  );
}
