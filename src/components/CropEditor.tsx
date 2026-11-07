"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  cropFromView,
  defaultCoverCrop,
  viewFromCrop,
  type Crop,
} from "@/lib/crop";

/**
 * Drag to pan, scroll or slider to zoom. The viewport is locked to the output
 * file's aspect ratio, so what you see is exactly what gets written.
 */
export function CropEditor({
  file,
  targetW,
  targetH,
  sourceUrl,
  initial,
  onSave,
  onClose,
  ownImage,
  onReplace,
  onUseGroupImage,
}: {
  file: string;
  targetW: number;
  targetH: number;
  sourceUrl: string;
  initial: Crop | null;
  onSave: (crop: Crop | null) => void;
  onClose: () => void;
  /** True when this file uses its own image. */
  ownImage: boolean;
  onReplace: () => void;
  onUseGroupImage: () => void;
}) {
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  const [zoom, setZoom] = useState(1);
  const [centre, setCentre] = useState({ x: 0.5, y: 0.5 });
  const [dragging, setDragging] = useState(false);
  const [history, setHistory] = useState<{ zoom: number; centre: { x: number; y: number } }[]>([]);
  const viewportRef = useRef<HTMLDivElement>(null);
  const dragFrom = useRef<{ mx: number; my: number; cx: number; cy: number } | null>(null);

  const [loadFailed, setLoadFailed] = useState(false);

  // Seed from the saved crop, or from what an automatic render would produce.
  useEffect(() => {
    let current = true;
    setLoadFailed(false);
    const img = new Image();
    img.onerror = () => {
      if (current) setLoadFailed(true);
    };
    img.onload = () => {
      if (!current) return;
      setSize({ w: img.naturalWidth, h: img.naturalHeight });
      if (initial) {
        const v = viewFromCrop(initial, img.naturalWidth, img.naturalHeight, targetW, targetH);
        setZoom(v.zoom);
        setCentre({ x: v.centreX, y: v.centreY });
      } else {
        setZoom(1);
        setCentre({ x: 0.5, y: 0.5 });
      }
    };
    img.src = sourceUrl;
    return () => {
      current = false;
    };
  }, [sourceUrl, initial, targetW, targetH]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const pushHistory = useCallback(() => {
    setHistory((h) => [...h.slice(-24), { zoom, centre }]);
  }, [zoom, centre]);

  function undo() {
    setHistory((h) => {
      const prev = h[h.length - 1];
      if (!prev) return h;
      setZoom(prev.zoom);
      setCentre(prev.centre);
      return h.slice(0, -1);
    });
  }

  function reset() {
    pushHistory();
    setZoom(1);
    setCentre({ x: 0.5, y: 0.5 });
  }

  if (loadFailed) {
    return (
      <div className="lightbox" onClick={onClose}>
        <div className="lightbox-inner" onClick={(e) => e.stopPropagation()}>
          <div className="note bad">
            The source image for {file} could not be loaded. It may be missing from the pack.
            Replace it to carry on.
          </div>
          <div className="actions">
            <button className="btn" onClick={onReplace}>
              Replace image…
            </button>
            {ownImage && (
              <button className="btn ghost" onClick={onUseGroupImage}>
                Use the pack&apos;s image
              </button>
            )}
            <button className="btn ghost" onClick={onClose}>
              Close
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (!size) {
    return (
      <div className="lightbox" onClick={onClose}>
        <div className="lightbox-inner" onClick={(e) => e.stopPropagation()}>
          <span className="spinner" /> Loading image…
        </div>
      </div>
    );
  }

  const crop = cropFromView(zoom, centre.x, centre.y, size.w, size.h, targetW, targetH);
  const base = defaultCoverCrop(size.w, size.h, targetW, targetH);

  // The viewport shows `crop` of the source. Scale the image so that region
  // exactly fills it, then offset so the crop's top-left sits at the origin.
  const VIEW_W = 520;
  const viewH = Math.round((VIEW_W * targetH) / targetW);
  const scale = VIEW_W / (crop.w * size.w);
  const imgW = size.w * scale;
  const imgH = size.h * scale;
  const offsetX = -crop.x * imgW;
  const offsetY = -crop.y * imgH;

  function onPointerDown(e: React.PointerEvent) {
    pushHistory();
    setDragging(true);
    dragFrom.current = { mx: e.clientX, my: e.clientY, cx: centre.x, cy: centre.y };
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  }

  function onPointerMove(e: React.PointerEvent) {
    const from = dragFrom.current;
    if (!dragging || !from || !size) return;
    // Pixels dragged -> fraction of the source image moved.
    const dx = (e.clientX - from.mx) / (size.w * scale);
    const dy = (e.clientY - from.my) / (size.h * scale);
    setCentre({
      x: Math.min(Math.max(from.cx - dx, 0), 1),
      y: Math.min(Math.max(from.cy - dy, 0), 1),
    });
  }

  function onPointerUp() {
    setDragging(false);
    dragFrom.current = null;
  }

  return (
    <div className="lightbox" onClick={onClose}>
      <div className="lightbox-inner" onClick={(e) => e.stopPropagation()}>
        <div className="lightbox-head">
          <code>{file}</code>
          <span className="dims">
            {targetW} x {targetH}
          </span>
          <button className="btn ghost small" onClick={onClose}>
            Close
          </button>
        </div>

        <div
          className="crop-viewport"
          ref={viewportRef}
          style={{ width: VIEW_W, height: viewH, cursor: dragging ? "grabbing" : "grab" }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          onWheel={(e) => {
            const next = Math.min(Math.max(zoom * (e.deltaY < 0 ? 1.08 : 0.926), 1), 12);
            setZoom(next);
          }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={sourceUrl}
            alt=""
            draggable={false}
            style={{
              position: "absolute",
              width: imgW,
              height: imgH,
              left: offsetX,
              top: offsetY,
              maxWidth: "none",
              userSelect: "none",
            }}
          />
        </div>

        <div className="crop-controls">
          <label>
            Zoom
            <input
              type="range"
              min={1}
              max={12}
              step={0.01}
              value={zoom}
              onPointerDown={pushHistory}
              onChange={(e) => setZoom(Number(e.target.value))}
            />
            <span className="dims">{zoom.toFixed(2)}x</span>
          </label>
        </div>

        <p className="hint" style={{ margin: "4px 0 14px" }}>
          Drag to reposition, scroll or use the slider to zoom. The frame is the
          exact {targetW} x {targetH} output.
        </p>

        <div className="actions">
          <button className="btn secondary" onClick={onReplace}>
            Replace image…
          </button>
          {ownImage && (
            <button className="btn ghost" onClick={onUseGroupImage} title="Go back to the pack's artwork or logo for this file">
              Use the pack&apos;s image
            </button>
          )}
          <button
            className="btn"
            onClick={() => onSave(cropFromView(zoom, centre.x, centre.y, size.w, size.h, targetW, targetH))}
          >
            Save crop
          </button>
          <button className="btn ghost" onClick={undo} disabled={history.length === 0}>
            Undo
          </button>
          <button className="btn ghost" onClick={reset} disabled={zoom === 1 && centre.x === 0.5 && centre.y === 0.5}>
            Reset framing
          </button>
          <button
            className="btn ghost"
            onClick={() => onSave(null)}
            disabled={!initial}
            title="Discard the saved crop and go back to automatic framing"
          >
            Clear saved crop
          </button>
          <span style={{ color: "var(--muted)", fontSize: 11.5, marginLeft: "auto" }}>
            auto would be {(base.w * 100).toFixed(0)}% x {(base.h * 100).toFixed(0)}% of the source
          </span>
        </div>
      </div>
    </div>
  );
}
