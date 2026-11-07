"use client";

import { useEffect, useState } from "react";
import { getJson } from "@/lib/client";
import type { SampleKind, SampleRule, SampleTags } from "@/lib/sampletags";

interface FolderInfo {
  folder: string;
  files: number;
}

interface Library {
  folders: FolderInfo[];
  suggestions: Record<string, SampleRule>;
  nonWav: number;
  sampleTags: SampleTags;
  types: string[][];
  characters: string[];
  note: string | null;
}

const MAX_TYPES = 3;
const KIND_LABEL: Record<SampleKind, string> = { oneshot: "One-shot", loop: "Loop", keep: "Leave as is" };
const typeLabel = (t: string[]) => t.join(" > ");

/** "", "Kicks", "Kicks/Hard" for "Kicks/Hard", without the folder itself. */
function parents(folder: string): string[] {
  const parts = folder ? folder.split("/") : [];
  return ["", ...parts.slice(0, -1).map((_, i) => parts.slice(0, i + 1).join("/"))].filter(
    (f) => f !== folder,
  );
}

function inherited<K extends keyof SampleRule>(
  rules: Record<string, SampleRule>,
  folder: string,
  key: K,
): SampleRule[K] {
  let value: SampleRule[K] = undefined;
  for (const p of parents(folder)) if (rules[p]?.[key] !== undefined) value = rules[p][key];
  return value;
}

function describe(rule: SampleRule | undefined): string {
  if (!rule) return "";
  return [
    rule.kind && KIND_LABEL[rule.kind],
    ...(rule.types ?? []).map(typeLabel),
    ...(rule.modes ?? []),
  ]
    .filter(Boolean)
    .join(", ");
}

/**
 * Rules per library folder for the TYPES, CHARACTERS and one-shot or loop
 * written into each WAV at install. A field a folder leaves unset takes its
 * parent folder's value.
 */
export function SampleTagsPanel({ packId, onSaved }: { packId: string; onSaved: () => void }) {
  const [library, setLibrary] = useState<Library | null>(null);
  const [tags, setTags] = useState<SampleTags | null>(null);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    let current = true;
    setLibrary(null);
    getJson<Library>(`/api/packs/${packId}/sample-tags`)
      .then((lib) => {
        if (!current) return;
        setLibrary(lib);
        setTags(lib.sampleTags);
        setDirty(false);
      })
      .catch((err) => current && setError((err as Error).message));
    return () => {
      current = false;
    };
  }, [packId]);

  if (error && !library) return <div className="note bad">{error}</div>;
  if (!library || !tags) {
    return (
      <div className="hint">
        <span className="spinner" /> Reading the library&apos;s folders from Maschine…
      </div>
    );
  }

  const change = (next: SampleTags) => {
    setTags(next);
    setDirty(true);
    setSaved(false);
  };

  const setField = <K extends keyof SampleRule>(folder: string, key: K, value: SampleRule[K]) => {
    const rule = { ...tags.rules[folder] };
    if (value === undefined) delete rule[key];
    else rule[key] = value;
    const rules = { ...tags.rules };
    if (Object.keys(rule).length === 0) delete rules[folder];
    else rules[folder] = rule;
    change({ ...tags, rules });
  };

  function applySuggestions() {
    const rules = { ...tags!.rules };
    for (const [folder, suggestion] of Object.entries(library!.suggestions)) {
      rules[folder] = { ...suggestion, ...rules[folder] };
    }
    change({ ...tags!, rules, matchFileNames: true });
  }

  async function save() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/packs/${packId}/sample-tags`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(tags),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Could not save the rules.");
      setTags(json.sampleTags);
      setDirty(false);
      setSaved(true);
      onSaved();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const totalFiles = library.folders.reduce((n, f) => n + f.files, 0);
  const hasSuggestions = Object.keys(library.suggestions).length > 0;

  return (
    <div className="sample-tags">
      <h3 style={{ margin: "0 0 4px" }}>Sample tags</h3>
      <p className="hint" style={{ marginTop: 0 }}>
        Written into each WAV at install, so the Maschine browser can filter this library by
        TYPE, CHARACTER and one-shot or loop. A folder with nothing set takes its parent
        folder&apos;s values.
      </p>

      {library.note && <div className="note">{library.note}</div>}
      {library.folders.length === 0 && !library.note && (
        <div className="note">Maschine lists no WAV files for this library yet. Let it scan the library first.</div>
      )}

      {library.folders.length > 0 && (
        <div className="st-table" role="table">
          <div className="st-row st-head" role="row">
            <span>Folder</span>
            <span>Kind</span>
            <span>TYPES</span>
            <span>CHARACTERS</span>
          </div>
          {library.folders.map(({ folder, files }) => {
            const rule = tags.rules[folder] ?? {};
            const depth = folder ? folder.split("/").length : 0;
            const name = folder ? folder.split("/").pop() : "All folders";
            const fromParent = folder !== "" || undefined;
            const parentKind = inherited(tags.rules, folder, "kind");
            const parentTypes = inherited(tags.rules, folder, "types");
            const parentModes = inherited(tags.rules, folder, "modes");
            const suggestion = library.suggestions[folder];
            const pending = suggestion && {
              kind: rule.kind === undefined ? suggestion.kind : undefined,
              types: rule.types === undefined ? suggestion.types : undefined,
            };
            return (
              <div className="st-row" role="row" key={folder || "(root)"}>
                <span style={{ paddingLeft: depth * 14 }}>
                  <b>{name}</b> <span className="dims">{files > 0 ? `${files} files` : ""}</span>
                  {pending && (pending.kind || pending.types) && (
                    <span className="st-suggest">suggested: {describe(pending)}</span>
                  )}
                </span>

                <span>
                  <select
                    value={rule.kind ?? ""}
                    onChange={(e) =>
                      setField(folder, "kind", (e.target.value || undefined) as SampleKind | undefined)
                    }
                  >
                    <option value="">
                      {fromParent ? `Same as parent${parentKind ? ` (${KIND_LABEL[parentKind]})` : ""}` : "Not set"}
                    </option>
                    {(Object.keys(KIND_LABEL) as SampleKind[]).map((k) => (
                      <option key={k} value={k}>
                        {KIND_LABEL[k]}
                      </option>
                    ))}
                  </select>
                </span>

                <span>
                  <PickList
                    values={(rule.types ?? []).map(typeLabel)}
                    options={library.types.map(typeLabel)}
                    max={MAX_TYPES}
                    placeholder="+ TYPE"
                    inheritedText={rule.types === undefined ? parentTypes?.map(typeLabel).join(", ") : undefined}
                    onChange={(labels) =>
                      setField(folder, "types", labels.length ? labels.map((l) => l.split(" > ")) : undefined)
                    }
                  />
                </span>

                <span>
                  <PickList
                    values={rule.modes ?? []}
                    options={library.characters}
                    placeholder="+ CHARACTER"
                    inheritedText={rule.modes === undefined ? parentModes?.join(", ") : undefined}
                    onChange={(modes) => setField(folder, "modes", modes.length ? modes : undefined)}
                  />
                </span>
              </div>
            );
          })}
        </div>
      )}

      <div className="checkline" style={{ marginTop: 12 }}>
        <input
          id="st-match"
          type="checkbox"
          checked={tags.matchFileNames}
          onChange={(e) => change({ ...tags, matchFileNames: e.target.checked })}
        />
        <label htmlFor="st-match" style={{ margin: 0 }}>
          Guess a file&apos;s TYPE and kind from its name where no rule sets them
        </label>
      </div>
      <div className="checkline">
        <input
          id="st-replace"
          type="checkbox"
          checked={tags.replaceExisting}
          onChange={(e) => change({ ...tags, replaceExisting: e.target.checked })}
        />
        <label htmlFor="st-replace" style={{ margin: 0 }}>
          Replace tags the files already have (off: only empty ones are filled)
        </label>
      </div>

      {library.nonWav > 0 && (
        <p className="hint">
          {library.nonWav} file{library.nonWav === 1 ? " is" : "s are"} not WAV and will be skipped.
        </p>
      )}

      <div className="actions">
        <button className="btn secondary" onClick={applySuggestions} disabled={busy || !hasSuggestions}>
          Suggest from names
        </button>
        <button className="btn" onClick={save} disabled={busy || !dirty}>
          {busy ? <><span className="spinner" /> Saving…</> : "Save rules"}
        </button>
        <button
          className="btn ghost"
          onClick={() => change({ ...tags, rules: {} })}
          disabled={busy || Object.keys(tags.rules).length === 0}
        >
          Clear all rules
        </button>
        {dirty && <span className="dims">Unsaved changes</span>}
        {saved && !dirty && <span className="dims">Saved. Check the install plan below to see what changes.</span>}
        <span className="dims" style={{ marginLeft: "auto" }}>
          {totalFiles} WAV files in {library.folders.filter((f) => f.files > 0).length} folders
        </span>
      </div>
      {error && <div className="note bad">{error}</div>}
    </div>
  );
}

/** Chips for the chosen values plus a select that adds one. */
function PickList({
  values,
  options,
  max,
  placeholder,
  inheritedText,
  onChange,
}: {
  values: string[];
  options: string[];
  max?: number;
  placeholder: string;
  inheritedText?: string;
  onChange: (values: string[]) => void;
}) {
  const full = max !== undefined && values.length >= max;
  return (
    <span className="st-pick">
      {values.map((v) => (
        <span className="chip st-chip" key={v}>
          {v}
          <button
            type="button"
            aria-label={`Remove ${v}`}
            onClick={() => onChange(values.filter((x) => x !== v))}
          >
            ×
          </button>
        </span>
      ))}
      {values.length === 0 && inheritedText && <span className="st-inherit">{inheritedText}</span>}
      {!full && (
        <select
          value=""
          onChange={(e) => {
            if (e.target.value) onChange([...values, e.target.value]);
          }}
        >
          <option value="">{placeholder}</option>
          {options
            .filter((o) => !values.includes(o))
            .map((o) => (
              <option key={o} value={o}>
                {o}
              </option>
            ))}
        </select>
      )}
    </span>
  );
}
