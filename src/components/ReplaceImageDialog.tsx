"use client";

import { useEffect, useMemo, useState } from "react";
import { ArtworkPicker, type ArtworkSource } from "@/components/ArtworkPicker";
import { LibraryPicker } from "@/components/LibraryPicker";
import { IMAGE_SPECS } from "@/lib/spec";
import type { LibraryImage } from "@/lib/packimages";
import type { Pack } from "@/lib/store";
import type { PreviewFile } from "@/lib/types";

type Scope = "file" | "artwork" | "logo";

export function ReplaceImageDialog({
  packId,
  file,
  fileSources,
  hasLogo,
  hasOpenAiKey,
  hasSerpKey,
  searchSeed,
  onDone,
  onClose,
}: {
  packId: string;
  file: PreviewFile;
  fileSources: Record<string, string>;
  /** Without a logo, the logo files render from the artwork too. Same rule as the server. */
  hasLogo: boolean;
  hasOpenAiKey: boolean;
  hasSerpKey: boolean;
  searchSeed?: string;
  onDone: (pack: Pack, skipped: string[]) => void;
  onClose: () => void;
}) {
  const spec = IMAGE_SPECS.find((s) => s.file === file.file)!;
  const [scope, setScope] = useState<Scope>(spec.source);
  const [from, setFrom] = useState<"picker" | "library">("picker");
  const [picked, setPicked] = useState<ArtworkSource | null>(null);
  const [libraryPick, setLibraryPick] = useState<LibraryImage | null>(null);
  const [width, setWidth] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const previewUrl = from === "library" ? libraryPick?.url ?? null : picked?.preview ?? null;
  useEffect(() => {
    setWidth(null);
    if (!previewUrl) return;
    const img = new Image();
    img.onload = () => setWidth(img.naturalWidth);
    img.src = previewUrl;
  }, [previewUrl]);

  const groupFiles = useMemo(
    () =>
      scope === "file"
        ? [file.file]
        : IMAGE_SPECS.filter((s) =>
            scope === "logo" ? s.source === "logo" : s.source === "artwork" || !hasLogo,
          ).map((s) => s.file),
    [scope, file.file, hasLogo],
  );
  const skipCount = scope === "file" ? 0 : groupFiles.filter((f) => f in fileSources).length;
  const neededWidth = Math.max(
    ...IMAGE_SPECS.filter((s) => groupFiles.includes(s.file)).map((s) => s.width),
  );

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const form = new FormData();
      form.set("scope", scope);
      form.set("file", file.file);
      if (from === "library" && libraryPick) {
        form.set("fromPack", libraryPick.packId);
        form.set("fromWhich", libraryPick.which);
      } else if (picked) {
        form.set("image", picked.blob, "image.png");
      }
      const res = await fetch(`/api/packs/${packId}/images`, { method: "POST", body: form });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "The image could not be replaced.");
      onDone(json.pack as Pack, json.skipped as string[]);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const ready = from === "library" ? libraryPick !== null : picked !== null;

  return (
    <div className="lightbox" onClick={onClose}>
      <div className="lightbox-inner" onClick={(e) => e.stopPropagation()}>
        <h3>Replace the image for {file.file}</h3>

        <div className="tabs" role="tablist">
          <button role="tab" aria-selected={from === "picker"} onClick={() => setFrom("picker")}>
            Upload, AI or search
          </button>
          <button role="tab" aria-selected={from === "library"} onClick={() => setFrom("library")}>
            Library
          </button>
        </div>

        {from === "picker" ? (
          <ArtworkPicker
            label="New image"
            hint="Use an image at least as wide as the file it replaces."
            value={picked}
            onChange={setPicked}
            allowAi
            hasOpenAiKey={hasOpenAiKey}
            hasSerpKey={hasSerpKey}
            searchSeed={searchSeed}
          />
        ) : (
          <LibraryPicker selected={libraryPick?.imageId ?? null} onPick={setLibraryPick} />
        )}

        <div className="field" style={{ marginTop: 14 }}>
          <label>Replace it for</label>
          {(["file", "artwork", "logo"] as const).map((s) => (
            <label key={s} className="inline-check">
              <input type="radio" name="scope" checked={scope === s} onChange={() => setScope(s)} />
              {s === "file" ? "This file only" : s === "artwork" ? "All artwork files" : "All logo files"}
            </label>
          ))}
        </div>

        {skipCount > 0 && (
          <div className="note">
            {skipCount} file{skipCount === 1 ? " has" : "s have"} its own image and will not change.
          </div>
        )}
        {width !== null && width < neededWidth && (
          <div className="note">
            This image is {width} px wide, and the widest file it feeds is {neededWidth} px, so it
            will look soft.
          </div>
        )}
        {error && <div className="note bad">{error}</div>}

        <div className="actions">
          <button className="btn" onClick={submit} disabled={!ready || busy}>
            {busy ? <><span className="spinner" /> Replacing…</> : "Replace"}
          </button>
          <button className="btn ghost" onClick={onClose} disabled={busy}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
