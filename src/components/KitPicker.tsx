"use client";

import { useEffect, useState } from "react";
import { getJson } from "@/lib/client";

interface Kit {
  name: string;
  sub: string;
  vendor: string;
  sounds: number;
  folder: string;
  hasArtwork: boolean;
}

interface KitScan {
  kits: Kit[];
  imageDir: string;
  dbPath: string | null;
  note?: string;
}

/**
 * Lists the kits Maschine knows about, so a name is picked rather than typed.
 * Getting the name wrong is the single most common reason artwork never
 * appears, and these come straight from Maschine's own browser index.
 */
export function KitPicker({
  onPick,
  current,
}: {
  onPick: (kit: Kit) => void;
  current: string;
}) {
  const [scan, setScan] = useState<KitScan | null>(null);
  const [filter, setFilter] = useState("");
  const [showAll, setShowAll] = useState(false);
  const [busy, setBusy] = useState(true);

  useEffect(() => {
    getJson<KitScan>("/api/kits")
      .then(setScan)
      .catch(() => setScan({ kits: [], imageDir: "", dbPath: null, note: "Could not read your kits." }))
      .finally(() => setBusy(false));
  }, []);

  if (busy) {
    return (
      <p className="hint">
        <span className="spinner" /> Reading your kits from Maschine…
      </p>
    );
  }
  if (!scan || scan.kits.length === 0) {
    return (
      <div className="note">
        {scan?.note ?? "No kits found."} You can still type a name by hand below.
      </div>
    );
  }

  const missing = scan.kits.filter((k) => !k.hasArtwork);
  const pool = showAll ? scan.kits : missing;
  const shown = pool.filter((k) =>
    filter ? k.name.toLowerCase().includes(filter.toLowerCase()) : true,
  );

  return (
    <div className="field">
      <label>
        Your kits
        <span className="sub">
          {missing.length} of {scan.kits.length} have no artwork
        </span>
      </label>

      <div className="row" style={{ alignItems: "center", marginBottom: 8 }}>
        <input
          type="text"
          placeholder="Filter by name…"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        />
        <div className="checkline" style={{ marginBottom: 0, flex: "0 0 auto" }}>
          <input
            id="show-all-kits"
            type="checkbox"
            checked={showAll}
            onChange={(e) => setShowAll(e.target.checked)}
          />
          <label htmlFor="show-all-kits" style={{ margin: 0 }}>
            Include kits that already have artwork
          </label>
        </div>
      </div>

      <div className="kit-list">
        {shown.slice(0, 200).map((k) => (
          <button
            key={k.folder}
            className="kit-row"
            aria-pressed={current.trim().toLowerCase() === k.name.toLowerCase()}
            onClick={() => onPick(k)}
          >
            <span className="kname">{k.name}</span>
            <span className="kmeta">
              {k.sounds.toLocaleString()} sound{k.sounds === 1 ? "" : "s"}
              {k.vendor ? ` - vendor "${k.vendor}"` : ""}
            </span>
            <span className={k.hasArtwork ? "kbadge has" : "kbadge"}>
              {k.hasArtwork ? "has artwork" : "no artwork"}
            </span>
          </button>
        ))}
        {shown.length === 0 && (
          <p className="hint" style={{ margin: 0 }}>
            Nothing matches that filter.
          </p>
        )}
      </div>
      {shown.length > 200 && (
        <p className="hint">Showing the first 200 of {shown.length}.</p>
      )}
    </div>
  );
}
