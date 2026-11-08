"use client";

import { useEffect, useState } from "react";
import { getJson, postJson } from "@/lib/client";

type Name = "OPENAI_API_KEY" | "SERPAPI_API_KEY" | "OPENAI_IMAGE_MODEL";
interface Status { set: boolean; source: "env" | "file" | null; hint: string | null }
interface Res { settings: Record<Name, Status>; home: string }

const FIELDS: { name: Name; label: string; help: string; secret: boolean }[] = [
  { name: "OPENAI_API_KEY", label: "OpenAI API key", help: "used only by Generate with AI", secret: true },
  { name: "SERPAPI_API_KEY", label: "SerpAPI key", help: "used only by Search for a logo", secret: true },
  { name: "OPENAI_IMAGE_MODEL", label: "Image model", help: "optional; empty uses the newest your account has", secret: false },
];

export function SettingsPanel({ onSaved }: { onSaved: () => void }) {
  const [res, setRes] = useState<Res | null>(null);
  const [draft, setDraft] = useState<Partial<Record<Name, string>>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    getJson<Res>("/api/settings").then(setRes, (e) => setError((e as Error).message));
  }, []);

  async function save(changes: Partial<Record<Name, string>>) {
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      setRes(await postJson<Res>("/api/settings", changes));
      setDraft({});
      setSaved(true);
      onSaved();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const dirty = Object.values(draft).some((v) => v);

  return (
    <>
      <p className="hint">
        Saved on this Mac only, in <code>{res?.home ?? "~/.iconmaschine"}/settings.json</code>. Only
        your user account can read that file. A new key works at once, with no restart.
      </p>
      {FIELDS.map((f) => {
        const s = res?.settings[f.name];
        return (
          <div className="field" key={f.name}>
            <label htmlFor={f.name}>
              {f.label}
              <span className="sub">{f.help}</span>
            </label>
            <input
              id={f.name}
              type={f.secret ? "password" : "text"}
              autoComplete="off"
              spellCheck={false}
              placeholder={s?.set ? `Set, ends in …${s.hint}` : "Not set"}
              value={draft[f.name] ?? ""}
              onChange={(e) => setDraft((d) => ({ ...d, [f.name]: e.target.value }))}
            />
            {s?.source === "env" && (
              <span className="sub">Set by an environment variable, which wins over this field.</span>
            )}
            {s?.source === "file" && (
              <button type="button" className="link-btn" disabled={busy} onClick={() => save({ [f.name]: "" })}>
                Remove
              </button>
            )}
          </div>
        );
      })}
      <div className="actions">
        <button className="btn" disabled={busy || !dirty} onClick={() => save(draft)}>
          {busy ? <><span className="spinner" /> Saving…</> : "Save"}
        </button>
      </div>
      {saved && <div className="note good">Saved.</div>}
      {error && <div className="note bad">{error}</div>}
    </>
  );
}
