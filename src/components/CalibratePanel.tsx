"use client";

import { useState } from "react";
import { postJson } from "@/lib/client";
import type { CalibrationResult } from "@/lib/types";

/**
 * Two things about the NKS format are not documented publicly: the exact size
 * of VB_logo.png, and what a real `.meta` file contains. Both are sitting on
 * this Mac inside libraries Native Instruments installed. This reads them.
 */
export function CalibratePanel({ onDone }: { onDone: () => void }) {
  const [result, setResult] = useState<CalibrationResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    setBusy(true);
    setError(null);
    try {
      const res = await postJson<{ result: CalibrationResult }>("/api/calibrate", {
        harvestMeta: true,
      });
      setResult(res.result);
      onDone();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <p className="hint">
        Reads the NI libraries already installed on this machine and compares them
        against the sizes this app uses. It also copies a real <code>.meta</code>{" "}
        file to use as the template for your packs. Nothing is modified.
      </p>

      <div className="actions">
        <button className="btn secondary" onClick={run} disabled={busy}>
          {busy ? <><span className="spinner" /> Scanning…</> : "Scan installed libraries"}
        </button>
      </div>

      {error && <div className="note bad">{error}</div>}

      {result && (
        <>
          <div className="note">
            Scanned <code>{result.scannedRoot}</code> - found{" "}
            {result.libraries.length} librar
            {result.libraries.length === 1 ? "y" : "ies"}.
            {result.metaTemplateHarvestedFrom
              ? ` Harvested a .meta template from ${result.metaTemplateHarvestedFrom}.`
              : " No .meta file found to harvest."}
          </div>

          <table className="calib">
            <thead>
              <tr>
                <th>File</th>
                <th>This app uses</th>
                <th>Found in your libraries</th>
              </tr>
            </thead>
            <tbody>
              {result.observations.map((o) => {
                const cls =
                  o.matchesSpec === null
                    ? "absent"
                    : o.matchesSpec
                      ? "match"
                      : "mismatch";
                return (
                  <tr key={o.file}>
                    <td>{o.file}</td>
                    <td>
                      {o.expected ? `${o.expected.width}x${o.expected.height}` : "-"}
                    </td>
                    <td className={cls}>
                      {o.sizes.length === 0 ? (
                        "not present in any library"
                      ) : (
                        /* Every distinct size, so a split distribution is visible
                           rather than hidden behind the most common one. */
                        o.sizes.map((s) => (
                          <div key={`${s.width}x${s.height}`}>
                            {s.width}x{s.height} &mdash; {s.count} of{" "}
                            {result.libraries.length}
                          </div>
                        ))
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>

          {result.observations.some((o) => o.matchesSpec === false) && (
            <div className="note">
              Some sizes differ from the built-in spec. Your installed libraries are
              the ground truth - update <code>src/lib/spec.ts</code> to match them.
            </div>
          )}

          {result.errors.length > 0 && (
            <div className="note bad">
              {result.errors.slice(0, 5).map((e) => (
                <div key={e}>{e}</div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
