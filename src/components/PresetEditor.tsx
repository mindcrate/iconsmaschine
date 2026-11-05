"use client";

import { useCallback, useEffect, useState } from "react";
import { getJson, postJson } from "@/lib/client";

interface PresetEntry {
  relPath: string;
  name: string;
  vendor: string;
  bankchain: string[];
  types: string[][];
  characters: string[];
  deviceType: string;
  bytes: number;
  error?: string;
}

interface TagVocabulary {
  types: string[][];
  characters: string[];
  vendors: string[];
  source: string;
  note?: string;
}

interface WriteResult {
  relPath: string;
  backupPath: string | null;
  unchanged: boolean;
}

const pathLabel = (t: string[]) => t.join(" > ");

/**
 * Edits the fields Maschine shows on GENERAL, TYPES and CHARACTERS. These live
 * in the preset file, not in dist_database, which is why a correct
 * dist_database entry alone never fixes them.
 */
export function PresetEditor() {
  const [root, setRoot] = useState("");
  const [rootExists, setRootExists] = useState(true);
  const [presets, setPresets] = useState<PresetEntry[]>([]);
  const [vocab, setVocab] = useState<TagVocabulary | null>(null);
  const [selected, setSelected] = useState<PresetEntry | null>(null);

  const [vendor, setVendor] = useState("");
  const [bankchain, setBankchain] = useState<string[]>(["", "", ""]);
  const [types, setTypes] = useState<string[][]>([]);
  const [characters, setCharacters] = useState<string[]>([]);
  const [typeFilter, setTypeFilter] = useState("");

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<WriteResult | null>(null);

  const refresh = useCallback(async () => {
    try {
      const data = await getJson<{
        root: string;
        rootExists: boolean;
        presets: PresetEntry[];
      }>("/api/presets");
      setRoot(data.root);
      setRootExists(data.rootExists);
      setPresets(data.presets);
    } catch (err) {
      setError((err as Error).message);
    }
  }, []);

  useEffect(() => {
    void refresh();
    void getJson<TagVocabulary>("/api/tagvocab").then(setVocab).catch(() => {});
  }, [refresh]);

  function select(p: PresetEntry) {
    setSelected(p);
    setVendor(p.vendor);
    setBankchain([p.bankchain[0] ?? "", p.bankchain[1] ?? "", p.bankchain[2] ?? ""]);
    setTypes(p.types);
    setCharacters(p.characters);
    setResult(null);
    setError(null);
  }

  async function save() {
    if (!selected) return;
    setBusy(true);
    setError(null);
    try {
      const res = await postJson<{ result: WriteResult }>("/api/presets", {
        path: selected.relPath,
        vendor,
        // Trailing blanks are how NI pads the chain; keep the shape at 3.
        bankchain,
        types,
        characters,
      });
      setResult(res.result);
      await refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function restore() {
    if (!selected || !confirm(`Restore ${selected.name} from its .bak?`)) return;
    setBusy(true);
    setError(null);
    try {
      await postJson("/api/presets", { path: selected.relPath, action: "restore" });
      await refresh();
      setResult(null);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const typeOptions = (vocab?.types ?? []).filter((t) =>
    typeFilter ? pathLabel(t).toLowerCase().includes(typeFilter.toLowerCase()) : true,
  );
  const hasType = (t: string[]) => types.some((x) => pathLabel(x) === pathLabel(t));

  if (!rootExists) {
    return (
      <div className="note bad">
        No User Content folder at <code>{root}</code>. Save a preset from a plugin
        in Maschine first - the folders are only created then.
      </div>
    );
  }

  return (
    <div>
      <p className="hint">
        Vendor, the GENERAL lines, TYPES and CHARACTERS live in the preset file
        itself. Edits are written in place, with a <code>.bak</code> kept beside
        the original.
      </p>

      {presets.length === 0 ? (
        <div className="note">
          No presets found under <code>{root}</code>. Save one from a plugin in
          Maschine, then reload.
        </div>
      ) : (
        <div className="preset-list">
          {presets.map((p) => (
            <button
              key={p.relPath}
              className="preset-row"
              aria-pressed={selected?.relPath === p.relPath}
              onClick={() => select(p)}
              disabled={Boolean(p.error)}
            >
              <span className="pname">{p.name || p.relPath}</span>
              <span className="pmeta">
                {p.error
                  ? `unreadable: ${p.error}`
                  : `${p.vendor || "no vendor"} - ${p.bankchain.filter(Boolean).join(" / ") || "no bank"}`}
              </span>
              <span className="pmeta">
                {p.error ? "" : `${p.types.length} type(s), ${p.characters.length} character(s)`}
              </span>
            </button>
          ))}
        </div>
      )}

      {selected && (
        <div className="preset-edit">
          <div className="row">
            <div className="field">
              <label>
                Vendor
                <span className="sub">what Maschine groups the preset under</span>
              </label>
              <input
                type="text"
                list="preset-vendors"
                value={vendor}
                onChange={(e) => setVendor(e.target.value)}
              />
              <datalist id="preset-vendors">
                {(vocab?.vendors ?? []).map((v) => (
                  <option key={v} value={v} />
                ))}
              </datalist>
            </div>
          </div>

          <div className="field">
            <label>
              GENERAL lines<span className="sub">the bank chain</span>
            </label>
            <div className="row">
              {bankchain.map((v, i) => (
                <input
                  key={i}
                  type="text"
                  placeholder={i === 0 ? "Vendor or product" : i === 1 ? "Product" : "(usually empty)"}
                  value={v}
                  onChange={(e) =>
                    setBankchain((prev) => prev.map((x, j) => (j === i ? e.target.value : x)))
                  }
                />
              ))}
            </div>
          </div>

          <div className="field">
            <label>
              TYPES
              <span className="sub">
                {types.length === 0 ? "none" : types.map(pathLabel).join(", ")}
              </span>
            </label>
            <input
              type="text"
              placeholder="Filter the type list…"
              value={typeFilter}
              onChange={(e) => setTypeFilter(e.target.value)}
              style={{ marginBottom: 8 }}
            />
            <div className="cat-grid" style={{ maxHeight: 200 }}>
              {typeOptions.slice(0, 400).map((t) => (
                <label key={pathLabel(t)}>
                  <input
                    type="checkbox"
                    checked={hasType(t)}
                    onChange={(e) =>
                      setTypes((prev) =>
                        e.target.checked
                          ? [...prev, t]
                          : prev.filter((x) => pathLabel(x) !== pathLabel(t)),
                      )
                    }
                  />
                  {pathLabel(t)}
                </label>
              ))}
            </div>
          </div>

          <div className="field">
            <label>
              CHARACTERS
              <span className="sub">
                {characters.length === 0 ? "none" : characters.join(", ")}
              </span>
            </label>
            <div className="cat-grid" style={{ maxHeight: 170 }}>
              {(vocab?.characters ?? []).map((c) => (
                <label key={c}>
                  <input
                    type="checkbox"
                    checked={characters.includes(c)}
                    onChange={(e) =>
                      setCharacters((prev) =>
                        e.target.checked ? [...prev, c] : prev.filter((x) => x !== c),
                      )
                    }
                  />
                  {c}
                </label>
              ))}
            </div>
          </div>

          {vocab && vocab.source === "fallback" && (
            <div className="note">
              Using the built-in tag list{vocab.note ? ` - ${vocab.note}` : ""}.
            </div>
          )}

          <div className="actions">
            <button className="btn" onClick={save} disabled={busy}>
              {busy ? <><span className="spinner" /> Saving…</> : "Save to preset"}
            </button>
            <button className="btn ghost" onClick={restore} disabled={busy}>
              Restore from .bak
            </button>
            <span style={{ color: "var(--muted)", fontSize: 11.5 }}>
              {selected.relPath}
            </span>
          </div>

          {error && <div className="note bad">{error}</div>}

          {result && (
            <div className="note good">
              {result.unchanged ? (
                "Nothing to change - the preset already matches."
              ) : (
                <>
                  Saved. Original backed up to <code>{result.backupPath}</code>.
                  <div style={{ marginTop: 6 }}>
                    <strong>Quit and relaunch Maschine</strong> to see the change.
                  </div>
                </>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
