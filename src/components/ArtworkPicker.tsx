"use client";

import { useEffect, useRef, useState } from "react";
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
  const [quality, setQuality] = useState<"low" | "medium" | "high">("low");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const [query, setQuery] = useState("");
  const [transparentOnly, setTransparentOnly] = useState(false);
  const [hits, setHits] = useState<ImageHit[] | null>(null);
  const [picking, setPicking] = useState<string | null>(null);
  const [viewing, setViewing] = useState<ImageHit | null>(null);
  // A double click also fires two clicks. Wait briefly before picking, so a
  // double click can open the large view instead.
  const clickTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (clickTimer.current) clearTimeout(clickTimer.current);
  }, []);

  function onHitClick(hit: ImageHit) {
    if (clickTimer.current) clearTimeout(clickTimer.current);
    clickTimer.current = setTimeout(() => {
      clickTimer.current = null;
      void pick(hit);
    }, 250);
  }

  function onHitDoubleClick(hit: ImageHit) {
    if (clickTimer.current) clearTimeout(clickTimer.current);
    clickTimer.current = null;
    setViewing(hit);
  }

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
                  onClick={() => onHitClick(h)}
                  onDoubleClick={() => onHitDoubleClick(h)}
                  disabled={picking !== null}
                  title={`${h.title}\n${h.source}${h.width ? ` - ${h.width}x${h.height}` : ""}\nDouble-click to see it larger`}
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
              Click an image to use it. Double-click to see it larger first.
              Results come from Google Images. Check you have the right to use an
              image before shipping a pack built from it.
            </p>
          )}
          {viewing && (
            <HitLightbox
              hit={viewing}
              busy={picking !== null}
              onUse={() => {
                const hit = viewing;
                setViewing(null);
                void pick(hit);
              }}
              onClose={() => setViewing(null)}
            />
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
                <option value="low">Low - cheapest, fine here</option>
                <option value="medium">Medium - ~8x the cost</option>
                <option value="high">High - ~35x the cost</option>
              </select>
            </div>
          </div>
          <p className="hint" style={{ marginTop: -6 }}>
            Low is the sensible default: the largest file this becomes is 417x65
            and the smallest is 96x47, so the extra detail in the higher tiers is
            destroyed by the downscale.
          </p>

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

/** A larger look at one search result before you use it. */
function HitLightbox({
  hit,
  busy,
  onUse,
  onClose,
}: {
  hit: ImageHit;
  busy: boolean;
  onUse: () => void;
  onClose: () => void;
}) {
  // The full image comes from the source site, which may refuse it. Fall back
  // to the thumbnail rather than show a broken image.
  const [src, setSrc] = useState(hit.original);

  useEffect(() => {
    // Capture phase, so Escape closes only this view and not a dialog under it.
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.stopImmediatePropagation();
      onClose();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onClose]);

  return (
    <div
      className="lightbox"
      style={{ zIndex: 60 }}
      onClick={(e) => {
        e.stopPropagation();
        onClose();
      }}
    >
      <div className="lightbox-inner hit-view" onClick={(e) => e.stopPropagation()}>
        <div className="lightbox-head">
          <code>{hit.title || hit.source}</code>
          <span className="dims">
            {hit.width ? `${hit.width} x ${hit.height}` : hit.source}
          </span>
          <button className="btn ghost small" onClick={onClose}>
            Close
          </button>
        </div>
        <div className="hit-view-image">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={src}
            alt={hit.title}
            onError={() => {
              if (src !== hit.thumbnail) setSrc(hit.thumbnail);
            }}
          />
        </div>
        {src === hit.thumbnail && hit.thumbnail !== hit.original && (
          <p className="hint">The source site would not show the full image, so this is the thumbnail.</p>
        )}
        <div className="actions">
          <button className="btn" onClick={onUse} disabled={busy}>
            Use this image
          </button>
          <button className="btn ghost" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
