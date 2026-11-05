"use client";

import { useState } from "react";
import { formatBytes, postJson } from "@/lib/client";
import type { InstallPlan, InstallResult } from "@/lib/types";

interface UninstallResult {
  removed: string[];
  keptFolders: string[];
}

export function InstallPanel({ packId }: { packId: string }) {
  const [plan, setPlan] = useState<InstallPlan | null>(null);
  const [result, setResult] = useState<InstallResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [removed, setRemoved] = useState<UninstallResult | null>(null);
  const [cleanStale, setCleanStale] = useState(true);

  async function remove() {
    if (
      !confirm(
        "Remove this pack's files from NI Resources?\n\nOnly files this app wrote are deleted. Anything else in those folders is left alone.",
      )
    )
      return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/packs/${packId}/install`, { method: "DELETE" });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Could not remove the pack.");
      setRemoved(json.result as UninstallResult);
      setResult(null);
      setPlan(null);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function run(dryRun: boolean) {
    setBusy(true);
    setError(null);
    if (dryRun) setResult(null);
    try {
      const res = await postJson<{ plan: InstallPlan; result?: InstallResult }>(
        `/api/packs/${packId}/install`,
        { dryRun, cleanStale },
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
        <button className="btn ghost" onClick={remove} disabled={busy}>
          Remove from NI Resources
        </button>
      </div>

      {error && <div className="note bad">{error}</div>}

      {removed && (
        <div className="note good">
          Removed {removed.removed.length} file
          {removed.removed.length === 1 ? "" : "s"}.
          {removed.keptFolders.length > 0 && (
            <div style={{ marginTop: 6 }}>
              Left these folders in place because they hold files this app did
              not write:
              <div style={{ fontFamily: "var(--mono)", fontSize: 11.5, marginTop: 4 }}>
                {removed.keptFolders.map((k) => (
                  <div key={k}>{k}</div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

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

          {plan.staleDirs.length > 0 && !result && (
            <div className="note">
              <div className="checkline" style={{ marginBottom: 6 }}>
                <input
                  id="clean-stale"
                  type="checkbox"
                  checked={cleanStale}
                  onChange={(e) => setCleanStale(e.target.checked)}
                />
                <label htmlFor="clean-stale" style={{ margin: 0 }}>
                  Also remove the old folders after installing
                </label>
              </div>
              <div style={{ fontFamily: "var(--mono)", fontSize: 11.5 }}>
                {plan.staleDirs.map((d) => (
                  <div key={d}>{d}</div>
                ))}
              </div>
              <div style={{ marginTop: 6, fontSize: 12 }}>
                Only files this app wrote are deleted, and only once the new
                location is in place.
              </div>
            </div>
          )}

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
