/**
 * The `dist_database` half of a pack.
 *
 * Maschine needs two trees per product. Images alone resolve to nothing:
 *
 *   NI Resources/image/<product>/                    artwork + <product>.meta
 *   NI Resources/dist_database/<vendor>/<product>/   the three JSON files
 *                                                    + <product>.meta
 *
 * Formats below are transcribed from a real installed entry
 * (futureaudioworkshop/sublab), not inferred.
 */

import { metaBuffer } from "./nimeta";

export interface DistDbInput {
  /** Properly cased vendor, e.g. "FutureAudioWorkshop". */
  vendor: string;
  /** Properly cased product, e.g. "SubLab". */
  product: string;
  /** "Instruments" or "Effects" - matched against the installed vocabulary. */
  fileType: string;
  /** One or more category strings, e.g. ["Synthesizers"]. */
  categories: string[];
  /** Six hex digits, no leading "#" - NI stores it bare. */
  bgColor: string;
  /** Short name for the hardware displays. Falls back to the product name. */
  shortName?: string | null;
}

/**
 * Real file:
 *   {
 *   "Vendor" : "FutureAudioWorkshop",
 *   "Product" : "SubLab",
 *   "CategoryDB" :
 *   [
 *   {
 *   "FileType" : "Instruments",
 *   "Categories" :
 *   [
 *   "Synthesizers"
 *   ]
 *   }
 *   ]
 *   }
 */
export function buildCategoriesJson(input: DistDbInput): string {
  return (
    JSON.stringify(
      {
        Vendor: input.vendor,
        Product: input.product,
        CategoryDB: [
          {
            FileType: input.fileType,
            Categories: input.categories,
          },
        ],
      },
      null,
      1,
    ) + "\n"
  );
}

/** Real file: `{ "VB_bgcolor" : "f4b021" }` - six hex digits, no "#". */
export function buildColorJson(input: DistDbInput): string {
  return JSON.stringify({ VB_bgcolor: normaliseHex(input.bgColor) }) + "\n";
}

/** Real file carries one short name per hardware generation. */
export function buildShortNameJson(input: DistDbInput): string {
  const short = (input.shortName || input.product).trim();
  return (
    JSON.stringify(
      {
        VB_shortname: short,
        MKII_shortname: short,
        MIKRO_shortname: short,
        MST_shortname: short,
      },
      null,
      1,
    ) + "\n"
  );
}

export function normaliseHex(hex: string): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  return m ? m[1].toLowerCase() : "000000";
}

export interface GeneratedFile {
  file: string;
  buffer: Buffer;
}

export function buildDistDbFiles(input: DistDbInput): GeneratedFile[] {
  return [
    { file: "categories.json", buffer: Buffer.from(buildCategoriesJson(input), "utf8") },
    { file: "color.json", buffer: Buffer.from(buildColorJson(input), "utf8") },
    { file: "shortname.json", buffer: Buffer.from(buildShortNameJson(input), "utf8") },
    {
      file: `${folderName(input.product)}.meta`,
      buffer: metaBuffer({
        name: input.product,
        vendor: input.vendor,
        type: "dist_database",
      }),
    },
  ];
}

/**
 * Installed folders are lowercase ("futureaudioworkshop", "sublab", "amplified
 * funk") while the XML and JSON carry the properly cased name. Mirroring that
 * convention keeps generated packs consistent with NI's own.
 */
export function folderName(display: string): string {
  return display.trim().toLowerCase();
}
