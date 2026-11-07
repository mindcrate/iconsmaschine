"use client";

import { useEffect, useState } from "react";
import { getJson } from "@/lib/client";
import type { LibraryImage } from "@/lib/packimages";

export function LibraryPicker({
  selected,
  onPick,
}: {
  selected: string | null;
  onPick: (image: LibraryImage) => void;
}) {
  const [images, setImages] = useState<LibraryImage[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getJson<{ images: LibraryImage[] }>("/api/library")
      .then((r) => setImages(r.images))
      .catch((err: Error) => setError(err.message));
  }, []);

  if (error) return <div className="note bad">{error}</div>;
  if (!images) return <div className="hint">Loading your saved images…</div>;
  if (images.length === 0) return <div className="hint">No saved images yet.</div>;

  return (
    <div className="ov-targets">
      {images.map((img) => (
        <button
          key={img.imageId}
          type="button"
          className={selected === img.imageId ? "ov-target on" : "ov-target"}
          aria-pressed={selected === img.imageId}
          onClick={() => onPick(img)}
          title={`From ${img.packName}`}
        >
          <span className="ov-shot" style={{ aspectRatio: "1 / 1" }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={img.url} alt="" />
          </span>
          <span className="ov-name">{img.packName}</span>
          <span className="ov-where">{img.which === "artwork" || img.which === "logo" ? img.which : "own image"}</span>
        </button>
      ))}
    </div>
  );
}
