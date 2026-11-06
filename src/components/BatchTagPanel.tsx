"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { getJson, postJson } from "@/lib/client";
import { TAG_FIELDS, type TagField } from "@/lib/tagfields";
import type { BatchReport, FieldChange, TagFields, TagRule } from "@/lib/presetbatch";

interface TagVocabulary {
  types: string[][];
  characters: string[];
  vendors: string[];
}

interface Values {
  vendor: string;
  bankchain: string[];
  types: string[][];
  characters: string[];
  author: string;
  comment: string;
}

const EMPTY_VALUES: Values = {
  vendor: "",
  bankchain: ["", "", ""],
  types: [],
  characters: [],
  author: "",
  comment: "",
};

const FIELD_LABELS: Record<TagField, string> = {
  vendor: "Vendor",
  bankchain: "GENERAL lines",
  types: "TYPES",
  characters: "CHARACTERS",
  author: "Author",
  comment: "Comment",
};

const pathLabel = (t: string[]) => t.join(" > ");

function show(field: TagField, value: unknown): string {
  if (field === "types") return (value as string[][]).map(pathLabel).join(", ") || "(none)";
  if (Array.isArray(value)) return (value as string[]).filter(Boolean).join(", ") || "(none)";
  return String(value) || "(empty)";
}

const describeChange = (c: FieldChange) =>
  `${c.field}: ${show(c.field, c.before)} → ${show(c.field, c.after)}`;

/** Every ancestor folder of every preset, with how many presets sit under it. */
function folderCounts(relPaths: string[]): Map<string, number> {
  const counts = new Map<string, number>([["", relPaths.length]]);
  for (const rel of relPaths) {
    const parts = rel.split("/").slice(0, -1);
    for (let i = 1; i <= parts.length; i++) {
      const folder = parts.slice(0, i).join("/");
      counts.set(folder, (counts.get(folder) ?? 0) + 1);
    }
  }
  return counts;
}

const folderLabel = (folder: string) => folder || "(all of User Content)";

/**
 * Sets chosen tag fields on every preset in a folder. A dry run comes first,
 * and a saved rule lets the same tags be applied again after a plugin
 * re-save reverts them.
 */
export function BatchTagPanel() {
  const [relPaths, setRelPaths] = useState<string[]>([]);
  const [vocab, setVocab] = useState<TagVocabulary | null>(null);
  const [rules, setRules] = useState<TagRule[]>([]);

  const [folder, setFolder] = useState("");
  const [picked, setPicked] = useState<Record<TagField, boolean>>(
    () => Object.fromEntries(TAG_FIELDS.map((f) => [f, false])) as Record<TagField, boolean>,
  );
  const [values, setValues] = useState<Values>(EMPTY_VALUES);
  const [typeFilter, setTypeFilter] = useState("");

  const [report, setReport] = useState<BatchReport | null>(null);
  const [previewKey, setPreviewKey] = useState<string | null>(null);
  const [totals, setTotals] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refreshRules = useCallback(async () => {
    const data = await getJson<{ rules: TagRule[] }>("/api/presets/batch");
    setRules(data.rules);
  }, []);

  useEffect(() => {
    void getJson<{ presets: { relPath: string }[] }>("/api/presets")
      .then((d) => setRelPaths(d.presets.map((p) => p.relPath)))
      .catch((err) => setError((err as Error).message));
    void getJson<TagVocabulary>("/api/tagvocab").then(setVocab).catch(() => {});
    void refreshRules().catch((err) => setError((err as Error).message));
  }, [refreshRules]);

  const counts = useMemo(() => folderCounts(relPaths), [relPaths]);
  const folders = useMemo(() => [...counts.keys()].sort((a, b) => a.localeCompare(b)), [counts]);

  const fields = useMemo(() => {
    const out: Record<string, unknown> = {};
    for (const f of TAG_FIELDS) if (picked[f]) out[f] = values[f];
    return out as TagFields;
  }, [picked, values]);
  const pickedCount = Object.keys(fields).length;
  const currentKey = JSON.stringify({ folder, fields });
  const previewIsCurrent = report?.dryRun === true && previewKey === currentKey;

  function loadRule(rule: TagRule) {
    setFolder(rule.folder);
    setPicked(
      Object.fromEntries(TAG_FIELDS.map((f) => [f, rule.fields[f] !== undefined])) as Record<
        TagField,
        boolean
      >,
    );
    setValues({
      ...EMPTY_VALUES,
      ...rule.fields,
      bankchain: [0, 1, 2].map((i) => rule.fields.bankchain?.[i] ?? ""),
    });
    setReport(null);
    setTotals(null);
    setDone(false);
  }

  function pickFolder(next: string) {
    setFolder(next);
    const rule = rules.find((r) => r.folder === next);
    if (rule) loadRule(rule);
    else {
      setReport(null);
      setTotals(null);
      setDone(false);
    }
  }

  async function run<T>(job: () => Promise<T>): Promise<T | undefined> {
    setBusy(true);
    setError(null);
    try {
      return await job();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const preview = () =>
    run(async () => {
      const r = await postJson<BatchReport>("/api/presets/batch", {
        action: "preview",
        folder,
        fields,
      });
      setReport(r);
      setPreviewKey(currentKey);
      setTotals(null);
      setDone(false);
    });

  const apply = () =>
    run(async () => {
      const r = await postJson<BatchReport>("/api/presets/batch", {
        action: "apply",
        folder,
        fields,
      });
      setReport(r);
      setTotals(null);
      setDone(true);
    });

  const saveRule = () =>
    run(async () => {
      await postJson("/api/presets/batch", { action: "save-rule", folder, fields });
      await refreshRules();
    });

  const reapply = (rule: TagRule) =>
    run(async () => {
      const r = await postJson<BatchReport>("/api/presets/batch", {
        action: "reapply",
        folder: rule.folder,
      });
      setReport(r);
      setTotals(null);
      setDone(true);
    });

  const reapplyAll = () =>
    run(async () => {
      const sum = { changed: 0, unchanged: 0, failed: 0 };
      for (const rule of rules) {
        const r = await postJson<BatchReport>("/api/presets/batch", {
          action: "reapply",
          folder: rule.folder,
        });
        sum.changed += r.counts.changed;
        sum.unchanged += r.counts.unchanged;
        sum.failed += r.counts.failed;
      }
      setReport(null);
      setTotals(
        `${rules.length} rule(s): ${sum.changed} changed, ${sum.unchanged} unchanged, ${sum.failed} failed.`,
      );
      setDone(true);
    });

  const removeRule = (rule: TagRule) => {
    if (!confirm(`Delete the rule for ${folderLabel(rule.folder)}?`)) return;
    void run(async () => {
      await postJson("/api/presets/batch", { action: "delete-rule", folder: rule.folder });
      await refreshRules();
    });
  };

  const setValue = <K extends TagField>(key: K, value: Values[K]) =>
    setValues((v) => ({ ...v, [key]: value }));
  const toggle = (f: TagField, on: boolean) => setPicked((p) => ({ ...p, [f]: on }));

  const typeOptions = (vocab?.types ?? []).filter((t) =>
    typeFilter ? pathLabel(t).toLowerCase().includes(typeFilter.toLowerCase()) : true,
  );

  function fieldRow(f: TagField, input: React.ReactNode) {
    return (
      <div className="field" key={f}>
        <label>
          <input
            type="checkbox"
            checked={picked[f]}
            onChange={(e) => toggle(f, e.target.checked)}
            style={{ marginRight: 8 }}
          />
          Set this field
          <span className="sub">{FIELD_LABELS[f]}</span>
        </label>
        <div style={{ opacity: picked[f] ? 1 : 0.5 }}>{input}</div>
      </div>
    );
  }

  const noPresets = relPaths.length === 0;

  return (
    <div>
      <p className="hint">
        Pick a folder and the fields to set on every preset in it. Preview shows
        what would change. Save the choice as a rule to apply it again after a
        plugin re-save reverts the tags.
      </p>

      {noPresets ? (
        <div className="note">No presets found. Save one from a plugin in Maschine, then reload.</div>
      ) : (
        <>
          <div className="field">
            <label>Folder</label>
            <select value={folder} onChange={(e) => pickFolder(e.target.value)}>
              {folders.map((f) => (
                <option key={f} value={f}>
                  {folderLabel(f)} ({counts.get(f)})
                </option>
              ))}
            </select>
          </div>

          {fieldRow(
            "vendor",
            <>
              <input
                type="text"
                list="batch-vendors"
                value={values.vendor}
                onChange={(e) => setValue("vendor", e.target.value)}
              />
              <datalist id="batch-vendors">
                {(vocab?.vendors ?? []).map((v) => (
                  <option key={v} value={v} />
                ))}
              </datalist>
            </>,
          )}

          {fieldRow(
            "bankchain",
            <div className="row">
              {values.bankchain.map((v, i) => (
                <input
                  key={i}
                  type="text"
                  placeholder={i === 0 ? "Vendor or product" : i === 1 ? "Product" : "(usually empty)"}
                  value={v}
                  onChange={(e) =>
                    setValue(
                      "bankchain",
                      values.bankchain.map((x, j) => (j === i ? e.target.value : x)),
                    )
                  }
                />
              ))}
            </div>,
          )}

          {fieldRow(
            "types",
            <>
              <span className="sub">
                {values.types.length === 0 ? "none" : values.types.map(pathLabel).join(", ")}
              </span>
              <input
                type="text"
                placeholder="Filter the type list…"
                value={typeFilter}
                onChange={(e) => setTypeFilter(e.target.value)}
                style={{ margin: "6px 0 8px" }}
              />
              <div className="cat-grid" style={{ maxHeight: 200 }}>
                {typeOptions.slice(0, 400).map((t) => (
                  <label key={pathLabel(t)}>
                    <input
                      type="checkbox"
                      checked={values.types.some((x) => pathLabel(x) === pathLabel(t))}
                      onChange={(e) =>
                        setValue(
                          "types",
                          e.target.checked
                            ? [...values.types, t]
                            : values.types.filter((x) => pathLabel(x) !== pathLabel(t)),
                        )
                      }
                    />
                    {pathLabel(t)}
                  </label>
                ))}
              </div>
            </>,
          )}

          {fieldRow(
            "characters",
            <div className="cat-grid" style={{ maxHeight: 170 }}>
              {(vocab?.characters ?? []).map((c) => (
                <label key={c}>
                  <input
                    type="checkbox"
                    checked={values.characters.includes(c)}
                    onChange={(e) =>
                      setValue(
                        "characters",
                        e.target.checked
                          ? [...values.characters, c]
                          : values.characters.filter((x) => x !== c),
                      )
                    }
                  />
                  {c}
                </label>
              ))}
            </div>,
          )}

          {fieldRow(
            "author",
            <input type="text" value={values.author} onChange={(e) => setValue("author", e.target.value)} />,
          )}
          {fieldRow(
            "comment",
            <input type="text" value={values.comment} onChange={(e) => setValue("comment", e.target.value)} />,
          )}

          <div className="actions">
            <button className="btn" onClick={preview} disabled={busy || pickedCount === 0}>
              {busy ? <><span className="spinner" /> Working…</> : "Preview"}
            </button>
            <button
              className="btn"
              onClick={apply}
              disabled={busy || !previewIsCurrent || (report?.counts.changed ?? 0) === 0}
            >
              Apply to {previewIsCurrent ? report?.counts.changed : 0} presets
            </button>
            <button className="btn ghost" onClick={saveRule} disabled={busy || pickedCount === 0}>
              Save as rule
            </button>
            {pickedCount === 0 && (
              <span style={{ color: "var(--muted)", fontSize: 11.5 }}>Pick at least one field.</span>
            )}
          </div>
        </>
      )}

      {error && <div className="note bad">{error}</div>}

      {totals && <div className="note good">{totals}</div>}

      {report && (
        <div className={report.counts.failed > 0 ? "note bad" : "note good"}>
          <strong>{report.dryRun ? "Preview" : "Applied"}</strong> for {folderLabel(report.folder)}:{" "}
          {report.counts.changed} {report.dryRun ? "would change" : "changed"},{" "}
          {report.counts.unchanged} unchanged, {report.counts.failed} failed.
          <div style={{ maxHeight: 260, overflowY: "auto", marginTop: 8, fontSize: 12 }}>
            {report.files
              .filter((f) => f.status !== "unchanged")
              .map((f) => (
                <div key={f.relPath} style={{ marginBottom: 6 }}>
                  <code>{f.relPath}</code>
                  {f.status === "failed" && <div>Failed: {f.error}</div>}
                  {f.status === "changed" &&
                    f.changes.map((c) => <div key={c.field}>{describeChange(c)}</div>)}
                </div>
              ))}
          </div>
        </div>
      )}

      {done && (
        <div className="note good">Done. Rescan in Maschine or restart it to see the new tags.</div>
      )}

      <h3 style={{ marginTop: 18, fontSize: 14 }}>Saved rules</h3>
      {rules.length === 0 ? (
        <p className="hint">No rules yet.</p>
      ) : (
        <>
          {rules.map((rule) => (
            <div className="actions" key={rule.folder} style={{ justifyContent: "space-between" }}>
              <span>
                <button className="btn ghost small" onClick={() => loadRule(rule)} disabled={busy}>
                  {folderLabel(rule.folder)}
                </button>{" "}
                <span style={{ color: "var(--muted)", fontSize: 11.5 }}>
                  {TAG_FIELDS.filter((f) => rule.fields[f] !== undefined).join(", ")} -{" "}
                  {new Date(rule.updatedAt).toLocaleDateString()}
                </span>
              </span>
              <span className="actions" style={{ marginTop: 0 }}>
                <button className="btn small" onClick={() => reapply(rule)} disabled={busy}>
                  Re-apply
                </button>
                <button className="btn ghost small" onClick={() => removeRule(rule)} disabled={busy}>
                  Delete
                </button>
              </span>
            </div>
          ))}
          <div className="actions">
            <button className="btn" onClick={reapplyAll} disabled={busy}>
              Re-apply all
            </button>
          </div>
        </>
      )}
    </div>
  );
}
