"use client";

import { useCallback, useEffect, useState } from "react";
import { getJson } from "@/lib/client";
import {
  describeCounts,
  GROUP_LABELS,
  type ContentCounts,
  type ContentGroup,
} from "@/lib/contenttype";

interface Kit {
  name: string;
  sub: string;
  vendor: string;
  sounds: number;
  folder: string;
  altFolder: string | null;
  hasArtwork: boolean;
  matchedBy: "vendor" | "name" | null;
  counts: ContentCounts;
  groups: ContentGroup[];
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
  reloadToken,
}: {
  onPick: (kit: Kit) => void;
  current: string;
  /** Bump this to re-read the database, e.g. after an install. */
  reloadToken?: number;
}) {
  const [scan, setScan] = useState<KitScan | null>(null);
  const [readAt, setReadAt] = useState<Date | null>(null);
  const [filter, setFilter] = useState("");
  const [showAll, setShowAll] = useState(false);
  const [group, setGroup] = useState<ContentGroup | "all">("all");
  const [busy, setBusy] = useState(true);

  const reload = useCallback(async () => {
    setBusy(true);
    try {
      setScan(await getJson<KitScan>("/api/kits"));
      setReadAt(new Date());
    } catch {
      setScan({
        kits: [],
        imageDir: "",
        dbPath: null,
        note: "Could not read your kits.",
      });
    } finally {
      setBusy(false);
    }
  }, []);

  // Re-reads on mount and whenever reloadToken changes - Maschine's database
  // is live, so kits added or artwork installed since the page loaded would
  // otherwise never appear.
  useEffect(() => {
    void reload();
  }, [reload, reloadToken]);

  if (busy && !scan) {
    return (
      <p className="hint">
        <span className="spinner" /> Reading your kits from Maschine…
      </p>
    );
  }
  if (!scan || scan.kits.length === 0) {
    return (
      <div>
        <div className="note">
          {scan?.note ?? "No kits found."} You can still type a name by hand
          below.
        </div>
        <button className="btn ghost small" onClick={reload} disabled={busy}>
          {busy ? <><span className="spinner" /> Reading…</> : "Re-read from Maschine"}
        </button>
      </div>
    );
  }

  const missing = scan.kits.filter((k) => !k.hasArtwork);
  const pool = showAll ? scan.kits : missing;
  const shown = pool
    .filter((k) => group === "all" || k.groups.includes(group))
    .filter((k) => (filter ? k.name.toLowerCase().includes(filter.toLowerCase()) : true));

  // Only offer a tab for a grouping that actually has kits behind it.
  const available = (["groups", "samples", "instruments", "effects", "other"] as const).filter(
    (g) => pool.some((k) => k.groups.includes(g)),
  );

  return (
    <div className="field">
      <label style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <span>
          Your kits
          <span className="sub">
            {missing.length} of {scan.kits.length} have no artwork
          </span>
        </span>
        <button
          type="button"
          className="btn ghost small"
          style={{ marginLeft: "auto" }}
          onClick={reload}
          disabled={busy}
          title="Read the kit list from Maschine again"
        >
          {busy ? <><span className="spinner" /> Reading…</> : "Refresh"}
        </button>
        {readAt && !busy && (
          <span className="sub" style={{ marginLeft: 0, fontWeight: 400 }}>
            read {readAt.toLocaleTimeString()}
          </span>
        )}
      </label>

      {available.length > 1 && (
        <div className="tabs" style={{ marginBottom: 10, flexWrap: "wrap" }}>
          <button aria-selected={group === "all"} onClick={() => setGroup("all")}>
            All ({pool.length})
          </button>
          {available.map((g) => (
            <button
              key={g}
              aria-selected={group === g}
              onClick={() => setGroup(g)}
            >
              {GROUP_LABELS[g]} ({pool.filter((k) => k.groups.includes(g)).length})
            </button>
          ))}
        </div>
      )}

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
              {describeCounts(k.counts)} &rarr; image/{k.folder}/
              {k.vendor ? ` (vendor)` : ` (bank)`}
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
