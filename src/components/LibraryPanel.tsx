"use client";

import type { Pack } from "@/lib/types";

export function LibraryPanel({
  packs,
  activeId,
  onOpen,
  onDelete,
}: {
  packs: Pack[];
  activeId: string | null;
  onOpen: (pack: Pack) => void;
  onDelete: (pack: Pack) => void;
}) {
  if (packs.length === 0) {
    return (
      <p className="hint" style={{ margin: 0 }}>
        Nothing saved yet. Packs you build show up here so you can re-edit,
        re-install or re-export them later.
      </p>
    );
  }

  return (
    <div>
      {packs.map((pack) => (
        <div className="lib-item" key={pack.id}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={`/api/packs/${pack.id}/source?which=artwork`} alt="" />
          <div className="meta">
            <strong>
              {pack.name}
              {pack.id === activeId && (
                <span style={{ color: "var(--accent)" }}> - open</span>
              )}
            </strong>
            <span>
              {pack.vendor ? `${pack.vendor} / ` : ""}
              {pack.product}
            </span>
            {pack.tags.length > 0 && (
              <div className="lib-tags">
                {pack.tags.map((t) => (
                  <i key={t}>{t}</i>
                ))}
              </div>
            )}
          </div>
          <button className="btn ghost small" onClick={() => onOpen(pack)}>
            Open
          </button>
          <a className="btn ghost small" href={`/api/packs/${pack.id}/export`}>
            .zip
          </a>
          <button className="btn ghost small" onClick={() => onDelete(pack)}>
            Delete
          </button>
        </div>
      ))}
    </div>
  );
}
