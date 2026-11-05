"use client";

import { useRef, useState } from "react";
import { dataUrlToBlob, getJson, postJson } from "@/lib/client";

interface ImageHit {
  title: string;
  thumbnail: string;
  original: string;
  width: number | null;
  height: number | null;
  source: string;
}

export interface ArtworkSource {
  /** Object URL or data URL for display. */
  preview: string;
  blob: Blob;
  origin: "upload" | "ai" | "search";
}

export function ArtworkPicker({
  label,
  hint,
  value,
  onChange,
  allowAi,
  hasOpenAiKey,
  hasSerpKey,
  searchSeed,
}: {
  label: string;
  hint: string;
  value: ArtworkSource | null;
  onChange: (source: ArtworkSource | null) => void;
  allowAi: boolean;
  hasOpenAiKey: boolean;
  hasSerpKey: boolean;
  /** Pre-fills the search box with the vendor / product being built. */
  searchSeed?: string;
}) {
  const [tab, setTab] = useState<"upload" | "ai" | "search">("upload");
  const [over, setOver] = useState(false);
  const [prompt, setPrompt] = useState("");
  const [size, setSize] = useState<"1024x1024" | "1536x1024">("1024x1024");
  const [quality, setQuality] = useState<"low" | "medium" | "high">("medium");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const [query, setQuery] = useState("");
  const [transparentOnly, setTransparentOnly] = useState(true);
  const [hits, setHits] = useState<ImageHit[] | null>(null);
  const [picking, setPicking] = useState<string | null>(null);

  async function search() {
    setBusy(true);
    setError(null);
    try {
      const q = (query || searchSeed || "").trim();
      if (q.length < 2) throw new Error("Enter something to search for.");
      const res = await getJson<{ results: ImageHit[] }>(
        `/api/image-search?q=${encodeURIComponent(q)}&transparent=${transparentOnly}`,
      );
      setHits(res.results);
      if (res.results.length === 0) {
        setError(
          transparentOnly
            ? "Nothing found with a transparent background. Try unticking that."
            : "Nothing found for that search.",
        );
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function pick(hit: ImageHit) {
    setPicking(hit.original);
    setError(null);
    try {
      const { dataUrl } = await postJson<{ dataUrl: string }>(
        "/api/image-search",
        { url: hit.original },
      );
      onChange({ preview: dataUrl, blob: dataUrlToBlob(dataUrl), origin: "search" });
    } catch (err) {
      setError(`Could not use that image: ${(err as Error).message}`);
    } finally {
      setPicking(null);
    }
  }

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
          <button
            role="tab"
            aria-selected={tab === "search"}
            onClick={() => setTab("search")}
          >
            Search for a logo
          </button>
        </div>
      )}

      {tab === "search" && allowAi ? (
        <div>
          {!hasSerpKey && (
            <div className="note bad">
              No <code>SERPAPI_API_KEY</code> in <code>.env.local</code>. Add one
              and restart the app to search.
            </div>
          )}
          <div className="row" style={{ alignItems: "flex-end" }}>
            <div className="field" style={{ flex: "2 1 300px" }}>
              <label>Search</label>
              <input
                type="text"
                placeholder={searchSeed ? `${searchSeed} logo` : "Serum logo"}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") void search();
                }}
              />
            </div>
            <div className="field" style={{ flex: "0 0 auto" }}>
              <div className="checkline" style={{ marginBottom: 0 }}>
                <input
                  id={`trans-${label}`}
                  type="checkbox"
                  checked={transparentOnly}
                  onChange={(e) => setTransparentOnly(e.target.checked)}
                />
                <label htmlFor={`trans-${label}`} style={{ margin: 0 }}>
                  Transparent only
                </label>
              </div>
            </div>
            <div className="field" style={{ flex: "0 0 auto" }}>
              <button
                className="btn"
                onClick={search}
                disabled={busy || !hasSerpKey}
              >
                {busy ? <><span className="spinner" /> Searching…</> : "Search"}
              </button>
            </div>
          </div>

          {hits && hits.length > 0 && (
            <div className="hit-grid">
              {hits.map((h) => (
                <button
                  key={h.original}
                  className="hit"
                  onClick={() => pick(h)}
                  disabled={picking !== null}
                  title={`${h.title}\n${h.source}${h.width ? ` - ${h.width}x${h.height}` : ""}`}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={h.thumbnail} alt={h.title} />
                  <span className="hit-meta">
                    {picking === h.original
                      ? "fetching…"
                      : h.width
                        ? `${h.width}x${h.height}`
                        : h.source}
                  </span>
                </button>
              ))}
            </div>
          )}
          {hits && hits.length > 0 && (
            <p className="hint" style={{ marginTop: 10 }}>
              Results come from Google Images. Check you have the right to use an
              image before shipping a pack built from it.
            </p>
          )}
        </div>
      ) : tab === "upload" || !allowAi ? (
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
              Source:{" "}
              {value.origin === "ai"
                ? "generated with AI"
                : value.origin === "search"
                  ? "found by image search"
                  : "uploaded"}
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
