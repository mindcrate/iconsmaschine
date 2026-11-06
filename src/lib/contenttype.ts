/**
 * Maschine's content types.
 *
 * `k_sound_info.device_type_flags` is a bitmask, decoded by pairing each value
 * with the file extensions behind it on a real system:
 *
 *   1  nksf nksn ens nmsv nki nabs nbkt nfm8 nrkt   Instrument
 *   2  ngrr nksfx nifx mxfx rkplr                   Effect
 *   4  wav aif   (156,416 + 2,896)                  One-shot
 *   8  wav aif   ( 50,969 +   741)                  Loop
 *   0  mxsnd mxgrp mxprj                            Maschine's own formats
 *
 * Flag 0 needs the extension to tell a Group from a Sound from a Project.
 */

export type ContentType =
  | "group"
  | "sound"
  | "project"
  | "oneshot"
  | "loop"
  | "instrument"
  | "effect"
  | "other";

export interface ContentCounts {
  group: number;
  sound: number;
  project: number;
  oneshot: number;
  loop: number;
  instrument: number;
  effect: number;
  other: number;
}

export function emptyCounts(): ContentCounts {
  return {
    group: 0,
    sound: 0,
    project: 0,
    oneshot: 0,
    loop: 0,
    instrument: 0,
    effect: 0,
    other: 0,
  };
}

const FLAG_INSTRUMENT = 1;
const FLAG_EFFECT = 2;
const FLAG_ONESHOT = 4;
const FLAG_LOOP = 8;

/**
 * A row's content type. The flags are a bitmask, but in practice each row
 * carries exactly one, so the most specific match wins.
 */
export function classify(flags: number, fileExt: string): ContentType {
  const ext = fileExt.trim().toLowerCase();

  if (flags === 0) {
    if (ext === "mxgrp") return "group";
    if (ext === "mxsnd") return "sound";
    if (ext === "mxprj") return "project";
    return "other";
  }
  if (flags & FLAG_ONESHOT) return "oneshot";
  if (flags & FLAG_LOOP) return "loop";
  if (flags & FLAG_INSTRUMENT) return "instrument";
  if (flags & FLAG_EFFECT) return "effect";
  return "other";
}

/** The groupings the UI offers, which is not one per content type. */
export type ContentGroup = "groups" | "samples" | "instruments" | "effects" | "other";

export function groupOf(type: ContentType): ContentGroup {
  switch (type) {
    case "group":
    case "sound":
      return "groups";
    case "oneshot":
    case "loop":
      return "samples";
    case "instrument":
      return "instruments";
    case "effect":
      return "effects";
    default:
      return "other";
  }
}

export const GROUP_LABELS: Record<ContentGroup, string> = {
  groups: "Groups & Sounds",
  samples: "Samples (one-shots & loops)",
  instruments: "Instruments",
  effects: "Effects",
  other: "Other",
};

export function groupCounts(counts: ContentCounts): Record<ContentGroup, number> {
  return {
    groups: counts.group + counts.sound,
    samples: counts.oneshot + counts.loop,
    instruments: counts.instrument,
    effects: counts.effect,
    other: counts.project + counts.other,
  };
}

/** The groups a kit actually holds content for, largest first. */
export function groupsPresent(counts: ContentCounts): ContentGroup[] {
  const g = groupCounts(counts);
  return (Object.keys(g) as ContentGroup[])
    .filter((k) => g[k] > 0)
    .sort((a, b) => g[b] - g[a]);
}

/** A short description, e.g. "2,304 one-shots, 1,950 loops". */
export function describeCounts(counts: ContentCounts): string {
  const parts: [keyof ContentCounts, string][] = [
    ["group", "group"],
    ["sound", "sound"],
    ["oneshot", "one-shot"],
    ["loop", "loop"],
    ["instrument", "instrument"],
    ["effect", "effect"],
    ["project", "project"],
    ["other", "other"],
  ];
  return parts
    .filter(([k]) => counts[k] > 0)
    .sort((a, b) => counts[b[0]] - counts[a[0]])
    .slice(0, 3)
    .map(([k, label]) => `${counts[k].toLocaleString()} ${label}${counts[k] === 1 ? "" : "s"}`)
    .join(", ");
}
