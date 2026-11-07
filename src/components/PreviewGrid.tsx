"use client";

import { formatBytes } from "@/lib/client";
import type { PreviewFile } from "@/lib/types";

export function PreviewGrid({
  files,
  croppedFiles,
  ownImageFiles,
  onEdit,
}: {
  files: PreviewFile[];
  croppedFiles: Set<string>;
  ownImageFiles: Set<string>;
  onEdit: (file: PreviewFile) => void;
}) {
  return (
    <div className="out-grid">
      {files.map((f) => (
        <div className="out-card" key={f.file}>
          <div
            className="canvas"
            onClick={() => onEdit(f)}
            title="Adjust the crop"
            role="button"
            tabIndex={0}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") onEdit(f);
            }}
          >
            {/*
              Wide files were previously capped at 200px wide, which crushed a
              1280x212 banner to 24px tall. Scale to fit the tile instead, so
              every file is actually legible.
              eslint-disable-next-line @next/next/no-img-element
            */}
            <img
              src={f.dataUrl}
              alt={f.file}
              style={{
                maxWidth: "100%",
                maxHeight: 120,
                width: f.width < 120 ? f.width : undefined,
              }}
            />
            <span className="edit-hint">adjust crop</span>
          </div>
          <code>{f.file}</code>
          <div className="dims">
            {f.width} x {f.height} - {formatBytes(f.bytes)}
          </div>
          <div className="desc">{f.description}</div>
          {croppedFiles.has(f.file) && (
            <span className="badge-cropped">hand-cropped</span>
          )}
          {ownImageFiles.has(f.file) && (
            <span className="badge-cropped">own image</span>
          )}
          {f.unverified && (
            <span
              className="badge-unverified"
              title="This file's dimensions are not documented publicly. Run Calibrate to confirm against a real NI library."
            >
              size unverified
            </span>
          )}
        </div>
      ))}
    </div>
  );
}
