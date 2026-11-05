"use client";

import { formatBytes } from "@/lib/client";
import type { PreviewFile } from "@/lib/types";

export function PreviewGrid({
  files,
  croppedFiles,
  onEdit,
}: {
  files: PreviewFile[];
  croppedFiles: Set<string>;
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
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={f.dataUrl}
              alt={f.file}
              style={{ width: Math.min(f.width, 200) }}
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
