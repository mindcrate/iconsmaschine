"use client";

import { useCallback, useEffect, useState } from "react";
import { getJson } from "@/lib/client";
import { describeCounts, GROUP_LABELS, type ContentGroup } from "@/lib/contenttype";
// Type-only, so nothing from the server module reaches the browser bundle.
// It was duplicated here and drifted: the copy lacked fields the scanner had
// been returning all along.
import type { Kit } from "@/lib/kits";

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

  // A kit whose artwork comes from a shared vendor folder is not really
  // "done" - it is showing some other product's art. Treat it as needing
  // attention so it does not vanish from the list, which is exactly what hid
  // Voodoo behind MOOSE LIFE's folder.
  const sharesVendorArt = (k: Kit) =>
    k.hasArtwork &&
    k.matchedBy === "vendor" &&
    k.vendor.trim().toLowerCase() !== k.name.trim().toLowerCase();

  // A kit whose audio is gone cannot be given artwork that would ever show.
  // Maschine keeps the bank chain after a library is deleted, so these pile up
  // - one machine carried ~700. They stay reachable under "show all".
  const missing = scan.kits.filter(
    (k) => !k.contentMissing && (!k.hasArtwork || sharesVendorArt(k)),
  );
  const pool = showAll ? scan.kits : missing;
  const shown = pool
    .filter((k) => group === "all" || k.groups.includes(group))
    .filter((k) => (filter ? k.name.toLowerCase().includes(filter.toLowerCase()) : true));

  // Only offer a tab for a grouping that actually has kits behind it.
  const GROUPS = ["groups", "samples", "instruments", "effects", "other"] as const;
  const available = GROUPS.filter((g) => pool.some((k) => k.groups.includes(g)));

  // When a search comes back empty, the kit is usually sitting under another
  // tab - Voodoo is one-shots and loops, so looking for it under Groups &
  // Sounds finds nothing. Say where it actually is instead of a dead end.
  const byName = filter
    ? scan.kits.filter((k) => k.name.toLowerCase().includes(filter.toLowerCase()))
    : [];
  const elsewhere =
    shown.length === 0 && byName.length > 0
      ? GROUPS.filter((g) => g !== group && byName.some((k) => k.groups.includes(g)))
      : [];
  // Or it is there, but hidden because it already has artwork.
  const hiddenByFilter =
    shown.length === 0 &&
    !showAll &&
    byName.some((k) => (group === "all" || k.groups.includes(group)) && !missing.includes(k));

  return (
    <div className="field">
      <label style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <span>
          Your kits
          <span className="sub">
            {missing.length} of {scan.kits.length} need artwork
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
              {k.nestUnder ? " (nested)" : " (flat)"}
            </span>
            <span
              className={
                k.contentMissing
                  ? "kbadge gone"
                  : k.hasArtwork && !sharesVendorArt(k)
                    ? "kbadge has"
                    : "kbadge"
              }
              title={
                k.contentMissing
                  ? "Maschine still lists this kit, but none of its audio folders are on disk. Deleted, moved, or on a drive that is not mounted."
                  : sharesVendorArt(k)
                    ? `Showing the artwork of vendor "${k.vendor}", shared with its other products`
                    : undefined
              }
            >
              {k.contentMissing
                ? "content missing"
                : !k.hasArtwork
                  ? "no artwork"
                  : sharesVendorArt(k)
                    ? `shares "${k.vendor}" art`
                    : "has artwork"}
            </span>
          </button>
        ))}
        {shown.length === 0 && (
          <p className="hint" style={{ margin: 0 }}>
            {elsewhere.length > 0 ? (
              <>
                No match here, but &ldquo;{filter}&rdquo; is under{" "}
                {elsewhere.map((g, i) => (
                  <span key={g}>
                    {i > 0 && (i === elsewhere.length - 1 ? " and " : ", ")}
                    <button
                      type="button"
                      className="linkish"
                      onClick={() => setGroup(g)}
                    >
                      {GROUP_LABELS[g]}
                    </button>
                  </span>
                ))}
                .
              </>
            ) : hiddenByFilter ? (
              <>
                &ldquo;{filter}&rdquo; is here but already has artwork. Tick{" "}
                <em>Include kits that already have artwork</em> to see it.
              </>
            ) : (
              "Nothing matches that filter."
            )}
          </p>
        )}
      </div>
      {shown.length > 200 && (
        <p className="hint">Showing the first 200 of {shown.length}.</p>
      )}
    </div>
  );
}
