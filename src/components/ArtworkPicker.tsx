"use client";

import { useRef, useState } from "react";
import { dataUrlToBlob, postJson } from "@/lib/client";

export interface ArtworkSource {
  /** Object URL or data URL for display. */
  preview: string;
  blob: Blob;
  origin: "upload" | "ai";
}

export function ArtworkPicker({
  label,
  hint,
  value,
  onChange,
  allowAi,
  hasOpenAiKey,
}: {
  label: string;
  hint: string;
  value: ArtworkSource | null;
  onChange: (source: ArtworkSource | null) => void;
  allowAi: boolean;
  hasOpenAiKey: boolean;
}) {
  const [tab, setTab] = useState<"upload" | "ai">("upload");
  const [over, setOver] = useState(false);
  const [prompt, setPrompt] = useState("");
  const [size, setSize] = useState<"1024x1024" | "1536x1024">("1024x1024");
  const [quality, setQuality] = useState<"low" | "medium" | "high">("medium");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  function accept(file: File | undefined) {
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setError("That is not an image file.");
      return;
    }
    setError(null);
    onChange({ preview: URL.createObjectURL(file), blob: file, origin: "upload" });
  }

  async function generate() {
    setBusy(true);
    setError(null);
    try {
      const { dataUrl } = await postJson<{ dataUrl: string }>("/api/generate", {
        prompt,
        size,
        quality,
      });
      onChange({ preview: dataUrl, blob: dataUrlToBlob(dataUrl), origin: "ai" });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <div className="field">
        <label>
          {label}
          <span className="sub">{hint}</span>
        </label>
      </div>

      {allowAi && (
        <div className="tabs" role="tablist">
          <button
            role="tab"
            aria-selected={tab === "upload"}
            onClick={() => setTab("upload")}
          >
            Upload an image
          </button>
          <button
            role="tab"
            aria-selected={tab === "ai"}
            onClick={() => setTab("ai")}
          >
            Generate with AI
          </button>
        </div>
      )}

      {tab === "upload" || !allowAi ? (
        <div
          className={over ? "drop over" : "drop"}
          onClick={() => inputRef.current?.click()}
          onDragOver={(e) => {
            e.preventDefault();
            setOver(true);
          }}
          onDragLeave={() => setOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setOver(false);
            accept(e.dataTransfer.files[0]);
          }}
        >
          <input
            ref={inputRef}
            type="file"
            accept="image/*"
            onChange={(e) => accept(e.target.files?.[0])}
          />
          Drop an image here, or click to choose one.
          <br />
          <small>
            Square or landscape, at least 1280px wide so the NKS2 banner stays sharp.
          </small>
        </div>
      ) : (
        <div>
          {!hasOpenAiKey && (
            <div className="note bad">
              No <code>OPENAI_API_KEY</code> in <code>.env.local</code>. Add one and
              restart the app to use this tab.
            </div>
          )}
          <div className="field">
            <textarea
              placeholder="e.g. a gold lion wearing a crown, dark smoky background, gritty hip-hop album cover"
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
            />
          </div>
          <div className="row">
            <div className="field">
              <label>Shape</label>
              <select
                value={size}
                onChange={(e) => setSize(e.target.value as typeof size)}
              >
                <option value="1024x1024">Square (1024 x 1024)</option>
                <option value="1536x1024">Landscape (1536 x 1024)</option>
              </select>
            </div>
            <div className="field">
              <label>Quality</label>
              <select
                value={quality}
                onChange={(e) => setQuality(e.target.value as typeof quality)}
              >
                <option value="low">Low - fastest, cheapest</option>
                <option value="medium">Medium</option>
                <option value="high">High - slowest</option>
              </select>
            </div>
          </div>
          <div className="actions">
            <button
              className="btn"
              onClick={generate}
              disabled={busy || prompt.trim().length < 3 || !hasOpenAiKey}
            >
              {busy ? <><span className="spinner" /> Generating…</> : "Generate artwork"}
            </button>
          </div>
        </div>
      )}

      {error && <div className="note bad">{error}</div>}

      {value && (
        <div className="source-preview">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={value.preview} alt="Selected artwork" />
          <div>
            <div style={{ color: "var(--muted)", fontSize: 12 }}>
              Source: {value.origin === "ai" ? "generated with AI" : "uploaded"}
            </div>
            <div className="actions">
              <button className="btn ghost small" onClick={() => onChange(null)}>
                Remove
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
