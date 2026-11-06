"use client";

import { useState } from "react";
import { formatBytes, postJson } from "@/lib/client";
import type { InstallPlan, InstallResult } from "@/lib/types";

type SampleTagResult = NonNullable<InstallResult["samples"]>;

interface UninstallResult {
  removed: string[];
  keptFolders: string[];
}

export function InstallPanel({
  packId,
  onChanged,
}: {
  packId: string;
  /** Fired after NI Resources is written to, so other panels can re-read. */
  onChanged?: () => void;
}) {
  const [plan, setPlan] = useState<InstallPlan | null>(null);
  const [result, setResult] = useState<InstallResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [removed, setRemoved] = useState<UninstallResult | null>(null);
  const [cleanStale, setCleanStale] = useState(true);
  const [backup, setBackup] = useState(true);
  const [retag, setRetag] = useState<SampleTagResult | null>(null);

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
      onChanged?.();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function run(dryRun: boolean, tagsOnly = false) {
    setBusy(true);
    setError(null);
    setRetag(null);
    if (dryRun) setResult(null);
    try {
      const res = await postJson<{
        plan: InstallPlan;
        result?: InstallResult;
        retag?: SampleTagResult | null;
      }>(`/api/packs/${packId}/install`, { dryRun, cleanStale, backup, tagsOnly });
      setPlan(res.plan);
      if (res.result) {
        setResult(res.result);
        onChanged?.();
      }
      if (res.retag) setRetag(res.retag);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const overwrites = plan?.writes.filter((w) => w.existing).length ?? 0;
  const blocked = plan ? !plan.rootExists || !plan.rootWritable : false;
  const hasSamples = Boolean(plan?.samples && plan.samples.count > 0);

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
            {plan.imageRoot}/
            <b>
              {/* Everything below the root, not just the last segment - a
                  nested pack writes to <vendor>/<product>/ and showing only
                  the product made it look as though nesting had not applied. */}
              {plan.imageDir.startsWith(`${plan.imageRoot}/`)
                ? plan.imageDir.slice(plan.imageRoot.length + 1)
                : plan.imageDir.split("/").pop()}
            </b>
            /
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

          {plan.samples && plan.samples.count > 0 && (
            <div className="note">
              {plan.samples.count} WAV file{plan.samples.count === 1 ? "" : "s"} will get
              the vendor and bank tag, so Maschine lists them under the vendor
              and not under Other. The audio is not changed.
              <div style={{ marginTop: 6, fontFamily: "var(--mono)", fontSize: 11.5 }}>
                {plan.samples.folders.map((f) => (
                  <div key={f}>{f}</div>
                ))}
              </div>
            </div>
          )}

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
              {hasSamples && (
                <>
                  <button
                    className="btn secondary"
                    onClick={() => run(false, true)}
                    disabled={busy}
                    title="Write the vendor and bank tags into the WAV files again, without touching the artwork."
                  >
                    Re-apply tags only
                  </button>
                  <label className="inline-check">
                    <input
                      type="checkbox"
                      checked={backup}
                      onChange={(e) => setBackup(e.target.checked)}
                    />
                    Back up the original WAV files first ({formatBytes(plan.samples!.bytes)} at most)
                  </label>
                </>
              )}
            </div>
          )}
          {hasSamples && backup && plan.backup && !result && (
            <div className="hint" style={{ marginTop: 6 }}>
              Copies go to {plan.backup.dir}. A file is copied only the first time it changes, so the
              copy stays the true original.
            </div>
          )}
        </>
      )}

      {retag && (
        <div className="note good">
          Re-applied tags: {retag.tagged} WAV file{retag.tagged === 1 ? "" : "s"} tagged,{" "}
          {retag.unchanged} already had the tag, {retag.skipped.length} skipped. The artwork was not
          touched.
          {retag.backupDir && retag.backedUp > 0 && (
            <> Backed up {retag.backedUp} original{retag.backedUp === 1 ? "" : "s"} to {retag.backupDir}.</>
          )}
          {retag.skipped.length > 0 && (
            <div style={{ marginTop: 4, fontFamily: "var(--mono)", fontSize: 11.5 }}>
              {retag.skipped.map((s) => (
                <div key={s.file}>
                  {s.file}: {s.reason}
                </div>
              ))}
            </div>
          )}
          <div style={{ marginTop: 8 }}>
            Rescan the library in Maschine 3, or quit and reopen it, to see the change.
          </div>
        </div>
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
          {result.samples && (
            <div style={{ marginTop: 8 }}>
              Tagged {result.samples.tagged} WAV file
              {result.samples.tagged === 1 ? "" : "s"}. {result.samples.unchanged} already
              had the tag. {result.samples.skipped.length} skipped.
              {result.samples.backupDir && result.samples.backedUp > 0 && (
                <> Backed up {result.samples.backedUp} original{result.samples.backedUp === 1 ? "" : "s"} to {result.samples.backupDir}.</>
              )}
              {result.samples.skipped.length > 0 && (
                <div style={{ marginTop: 4, fontFamily: "var(--mono)", fontSize: 11.5 }}>
                  {result.samples.skipped.map((s) => (
                    <div key={s.file}>
                      {s.file}: {s.reason}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
          <div style={{ marginTop: 8 }}>
            <strong>Fully quit and relaunch Maschine</strong> - a browser rescan
            alone often does not pick these up.
          </div>
        </div>
      )}
    </div>
  );
}
