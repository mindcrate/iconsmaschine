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
            {plan.imageRoot}/<b>{plan.imageDir.split("/").pop()}</b>/
          </div>
          {plan.distDbDir && (
            <div className="path-preview" style={{ marginTop: 8 }}>
              {plan.distDbRoot}/
              <b>{plan.distDbDir.split("/").slice(-2).join("/")}</b>/
            </div>
          )}

          {(["image", "dist_database"] as const).map((tree) => {
            const rows = plan.writes.filter((w) => w.tree === tree);
            if (rows.length === 0) return null;
            return (
              <div key={tree}>
                <div className="tree-label">{tree}/</div>
                <div className="plan">
                  {rows.map((w) => (
                    <div key={`${tree}/${w.file}`}>
                      <span className="path">{w.file}</span>
                      <span className="state">{formatBytes(w.bytes)}</span>
                      <span className={w.existing ? "state overwrite" : "state"}>
                        {w.existing ? "overwrites existing" : "new"}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}

          {plan.warnings.map((w) => (
            <div className="note" key={w}>
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
          Installed {result.written.length} files.
          <div style={{ marginTop: 6, fontFamily: "var(--mono)", fontSize: 12 }}>
            {result.imageDir}
            {result.distDbDir && (
              <>
                <br />
                {result.distDbDir}
              </>
            )}
          </div>
          <div style={{ marginTop: 8 }}>
            <strong>Fully quit and relaunch Maschine</strong> - a browser rescan
            alone often does not pick these up.
          </div>
        </div>
      )}
    </div>
  );
}
