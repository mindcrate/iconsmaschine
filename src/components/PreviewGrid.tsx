"use client";

import { formatBytes } from "@/lib/client";
import type { PreviewFile } from "@/lib/types";

export function PreviewGrid({ files }: { files: PreviewFile[] }) {
  return (
    <div className="out-grid">
      {files.map((f) => (
        <div className="out-card" key={f.file}>
          <div className="canvas">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={f.dataUrl}
              alt={f.file}
              style={{ width: Math.min(f.width, 200) }}
            />
          </div>
          <code>{f.file}</code>
          <div className="dims">
            {f.width} x {f.height} - {formatBytes(f.bytes)}
          </div>
          <div className="desc">{f.description}</div>
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
