"use client";

import { MAX_OVERLAY_TEXT, type TextOverlay } from "@/lib/overlayspec";
import type { PreviewFile } from "@/lib/types";

/** The minimum a target tile needs to explain itself. */
export interface OverlayTarget {
  file: string;
  width: number;
  height: number;
  description: string;
}

/**
 * The fonts offered. Deliberately short and all present on macOS, since a
 * name the renderer cannot resolve falls back silently to something else and
 * the output would differ from the preview without saying so.
 */
const FONTS = [
  "Helvetica",
  "Helvetica Neue",
  "Avenir Next",
  "Futura",
  "Gill Sans",
  "Impact",
  "Courier New",
  "Georgia",
  "Times New Roman",
];

export function OverlayControls({
  value,
  onChange,
  files,
  previews,
}: {
  value: TextOverlay;
  onChange: (next: TextOverlay) => void;
  /** Output files the overlay can be applied to. */
  files: OverlayTarget[];
  /** Rendered previews, when the pack has been rendered. Keyed by filename. */
  previews?: PreviewFile[] | null;
}) {
  const shotOf = (file: string) =>
    previews?.find((p) => p.file === file)?.dataUrl ?? null;
  const set = <K extends keyof TextOverlay>(key: K, v: TextOverlay[K]) =>
    onChange({ ...value, [key]: v });

  const toggleFile = (file: string) =>
    set(
      "files",
      value.files.includes(file)
        ? value.files.filter((f) => f !== file)
        : [...value.files, file],
    );

  const allPicked = files.length > 0 && files.every((f) => value.files.includes(f.file));
  const toggleAll = () => set("files", allPicked ? [] : files.map((f) => f.file));

  const on = value.text.trim().length > 0;

  return (
    <section className="step">
      <h2>
        Text on the logos
      </h2>
      <p className="hint">
        Burns the kit name across the logo and banner files, with the artwork
        behind it dimmed or replaced by a flat colour. Leave the text empty to
        use the artwork alone.
      </p>

      <div className="field">
        <label>
          Text
          <span
            className="sub"
            style={
              value.text.length >= MAX_OVERLAY_TEXT
                ? { color: "var(--danger)" }
                : undefined
            }
          >
            {value.text.length} / {MAX_OVERLAY_TEXT}
          </span>
        </label>
        <input
          type="text"
          placeholder="808 COLLECTION"
          maxLength={MAX_OVERLAY_TEXT}
          value={value.text}
          onChange={(e) => set("text", e.target.value.slice(0, MAX_OVERLAY_TEXT))}
        />
        {value.text.length > 28 && (
          <p className="hint" style={{ margin: "6px 0 0" }}>
            Long text is scaled down to fit, so it may end up small on the
            134&times;66 files.
          </p>
        )}
      </div>

      {on && (
        <>
          <div className="row">
            <div className="field">
              <label>Font</label>
              <select value={value.font} onChange={(e) => set("font", e.target.value)}>
                {FONTS.map((f) => (
                  <option key={f} value={f}>
                    {f}
                  </option>
                ))}
              </select>
              <label className="inline-check">
                <input
                  type="checkbox"
                  checked={value.weight === "bold"}
                  onChange={(e) => set("weight", e.target.checked ? "bold" : "normal")}
                />
                Bold
              </label>
              <label className="inline-check">
                <input
                  type="checkbox"
                  checked={value.italic}
                  onChange={(e) => set("italic", e.target.checked)}
                />
                Italic
              </label>
            </div>

            <div className="field">
              <label>
                Size<span className="sub">{Math.round(value.sizePct * 100)}% of height</span>
              </label>
              <input
                type="range"
                min={0.1}
                max={1}
                step={0.01}
                value={value.sizePct}
                onChange={(e) => set("sizePct", Number(e.target.value))}
              />
              <label>
                Letter spacing<span className="sub">{value.letterSpacing}%</span>
              </label>
              <input
                type="range"
                min={-10}
                max={50}
                step={1}
                value={value.letterSpacing}
                onChange={(e) => set("letterSpacing", Number(e.target.value))}
              />
            </div>

            <div className="field">
              <label>Text colour</label>
              <input
                type="color"
                value={value.color}
                onChange={(e) => set("color", e.target.value)}
              />
              <label style={{ marginTop: 10 }}>Align</label>
              <div className="checkline">
                {(["left", "centre", "right"] as const).map((a) => (
                  <button
                    key={a}
                    type="button"
                    className={value.align === a ? "btn small" : "btn ghost small"}
                    onClick={() => set("align", a)}
                  >
                    {a}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="row">
            <div className="field">
              <label>Background colour</label>
              <div className="checkline">
                <input
                  id="ov-bg"
                  type="checkbox"
                  checked={value.backgroundColor !== null}
                  onChange={(e) => set("backgroundColor", e.target.checked ? "#000000" : null)}
                />
                <label htmlFor="ov-bg" style={{ margin: 0 }}>
                  Paint a colour behind
                </label>
              </div>
              {value.backgroundColor !== null && (
                <input
                  type="color"
                  value={value.backgroundColor}
                  onChange={(e) => set("backgroundColor", e.target.value)}
                />
              )}
            </div>

            <div className="field">
              <label>
                Artwork opacity
                <span className="sub">{Math.round(value.backgroundOpacity * 100)}%</span>
              </label>
              <input
                type="range"
                min={0}
                max={1}
                step={0.01}
                value={value.backgroundOpacity}
                onChange={(e) => set("backgroundOpacity", Number(e.target.value))}
              />
              <p className="hint" style={{ margin: "6px 0 0" }}>
                0% drops the artwork entirely and leaves the colour behind the
                text.
              </p>
            </div>
          </div>

          <div className="field">
            <label>
              Apply to<span className="sub">{value.files.length} selected</span>
              <button
                type="button"
                className="btn ghost small"
                style={{ marginLeft: 10 }}
                onClick={toggleAll}
              >
                {allPicked ? "Clear all" : "Select all"}
              </button>
            </label>
            <p className="hint" style={{ margin: "0 0 10px" }}>
              Filenames are NI's, not yours - the picture and the note under
              each one say where it actually shows up.
            </p>
            <div className="ov-targets">
              {files.map((f) => {
                const picked = value.files.includes(f.file);
                const shot = shotOf(f.file);
                return (
                  <button
                    key={f.file}
                    type="button"
                    className={picked ? "ov-target on" : "ov-target"}
                    aria-pressed={picked}
                    onClick={() => toggleFile(f.file)}
                    title={f.description}
                  >
                    <span
                      className="ov-shot"
                      /* Hold the file's real aspect ratio so the tile reads as
                         that shape even before anything has been rendered. */
                      style={{ aspectRatio: `${f.width} / ${f.height}` }}
                    >
                      {shot ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={shot} alt="" />
                      ) : (
                        <span className="ov-shot-empty">
                          {f.width}&times;{f.height}
                        </span>
                      )}
                    </span>
                    <span className="ov-name">{f.file}</span>
                    <span className="ov-where">{f.description}</span>
                  </button>
                );
              })}
            </div>
            {value.files.length === 0 && (
              <p className="hint" style={{ margin: "10px 0 0" }}>
                Nothing selected, so the text will not appear on any file.
              </p>
            )}
          </div>
        </>
      )}
    </section>
  );
}
