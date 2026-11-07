import type { KitType } from "./spec";

export type StepId =
  | "kit" | "name" | "browser" | "artwork" | "text" | "details" | "review" | "sampletags" | "install";
export type ToolId = "presets" | "batch";
export type PageId = "packs" | "calibrate";
export type ViewId = StepId | ToolId | PageId;

/** What the steps need to know about the pack being made. */
export interface PackFacts {
  kitType: KitType;
  /** False for a new pack until a kit card is clicked. */
  kitChosen: boolean;
  /** Product name valid, and for a plugin a valid vendor too. */
  nameValid: boolean;
  /** A plugin's dist_database fields: a file type and at least one category. */
  browserValid: boolean;
  hasArtwork: boolean;
  /** Images built and previewed for the current fields. */
  built: boolean;
  /** A sample kit nested under a vendor, which is what gets WAV tags. */
  nestedSampleKit: boolean;
  installed: boolean;
}

interface StepRow {
  id: StepId;
  label: string;
  kits: readonly KitType[] | "all";
  /** Shown only when this also holds, beyond the kit type. */
  appliesWhen?: (f: PackFacts) => boolean;
  /** An optional step is never done and never blocks the steps after it. */
  optional?: boolean;
  done: (f: PackFacts) => boolean;
  /** Steps that must be done (or optional and open) first. Steps the kit type hides are ignored. */
  needs: readonly StepId[];
}

const never = () => false;

export const STEPS: readonly StepRow[] = [
  { id: "kit", label: "Kit type", kits: "all", done: (f) => f.kitChosen, needs: [] },
  { id: "name", label: "Name it", kits: "all", done: (f) => f.nameValid, needs: ["kit"] },
  { id: "browser", label: "Browser entry", kits: ["plugin"], done: (f) => f.browserValid, needs: ["name"] },
  { id: "artwork", label: "Artwork", kits: "all", done: (f) => f.hasArtwork, needs: ["name", "browser"] },
  { id: "text", label: "Text on the logos", kits: "all", optional: true, done: never, needs: ["artwork"] },
  { id: "details", label: "Details", kits: "all", optional: true, done: never, needs: ["artwork"] },
  { id: "review", label: "Review and build", kits: "all", done: (f) => f.built, needs: ["artwork"] },
  {
    id: "sampletags", label: "Sample tags", kits: ["sample_kit"], optional: true, done: never,
    appliesWhen: (f) => f.nestedSampleKit, needs: ["review"],
  },
  { id: "install", label: "Install", kits: "all", done: (f) => f.installed, needs: ["review"] },
];

export const TOOLS: readonly { id: ToolId; label: string; kits: readonly KitType[] }[] = [
  { id: "presets", label: "Preset tags", kits: ["plugin", "kontakt"] },
  { id: "batch", label: "Batch preset tags", kits: ["plugin", "kontakt"] },
];

export const PAGES: readonly { id: PageId; label: string }[] = [
  { id: "packs", label: "Your packs" },
  { id: "calibrate", label: "Calibrate" },
];

export type StepState = "done" | "open" | "locked";

export interface StepView {
  id: StepId;
  label: string;
  optional: boolean;
  state: StepState;
  /** Direct needs not yet met. Empty unless locked. */
  missing: StepId[];
}

const applies = (row: StepRow, f: PackFacts) =>
  (row.kits === "all" || row.kits.includes(f.kitType)) && (row.appliesWhen?.(f) ?? true);

/** The steps for this kit type, in order, each with its state. */
export function stepViews(f: PackFacts): StepView[] {
  const rows = STEPS.filter((r) => applies(r, f));
  const shown = new Set(rows.map((r) => r.id));
  const met = new Set<StepId>();
  return rows.map((r) => {
    const missing = r.needs.filter((n) => shown.has(n) && !met.has(n));
    const open = missing.length === 0;
    const done = open && r.done(f);
    if (open && (done || r.optional)) met.add(r.id);
    return { id: r.id, label: r.label, optional: Boolean(r.optional), state: open ? (done ? "done" : "open") : "locked", missing };
  });
}

/** The earliest steps still to do before `id` can open, following locked needs back to their cause. */
export function blockers(views: StepView[], id: StepId): StepId[] {
  const byId = new Map(views.map((v) => [v.id, v]));
  const out = new Set<StepId>();
  const walk = (s: StepId) => {
    const v = byId.get(s);
    if (!v) return;
    for (const m of v.missing) {
      if (byId.get(m)?.state === "locked") walk(m);
      else out.add(m);
    }
  };
  walk(id);
  return [...out];
}

const canLeave = (v: StepView) => v.state === "done" || v.optional;

/** The step Next goes to, or null when the current step must be finished first. */
export function nextStep(views: StepView[], current: StepId): StepId | null {
  const i = views.findIndex((v) => v.id === current);
  if (i < 0 || !canLeave(views[i])) return null;
  return views.slice(i + 1).find((v) => v.state !== "locked")?.id ?? null;
}

export function prevStep(views: StepView[], current: StepId): StepId | null {
  const i = views.findIndex((v) => v.id === current);
  return i <= 0 ? null : (views.slice(0, i).reverse().find((v) => v.state !== "locked")?.id ?? null);
}

/** `current` if it is shown and open, else the last open step before where it sits in the table. */
export function fallbackStep(views: StepView[], current: StepId): StepId {
  const here = views.find((v) => v.id === current);
  if (here && here.state !== "locked") return current;
  const order = STEPS.map((s) => s.id);
  const limit = order.indexOf(current);
  const before = views.filter((v) => v.state !== "locked" && order.indexOf(v.id) < limit);
  return before.length ? before[before.length - 1].id : "kit";
}

export const toolsFor = (k: KitType) => TOOLS.filter((t) => t.kits.includes(k));

export const isStep = (v: ViewId): v is StepId => STEPS.some((s) => s.id === v);
