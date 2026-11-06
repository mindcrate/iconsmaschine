/**
 * NI `.meta` resource files.
 *
 * These are small XML documents, not an opaque binary format. Two real examples
 * read from an installed system:
 *
 *   image/amplified funk/amplified funk.meta
 *     <?xml version="1.0" encoding="UTF-8" standalone="no" ?>
 *     <resource version="2.654.0.0">
 *       <name>Amplified Funk</name>
 *       <type>image</type>
 *     </resource>
 *
 *   dist_database/futureaudioworkshop/sublab/sublab.meta
 *     <?xml version="1.0" encoding="UTF-8" standalone="no" ?>
 *     <resource version="1.0.0.0">
 *       <vendor>FutureAudioWorkshop</vendor>
 *       <name>SubLab</name>
 *       <type>dist_database</type>
 *     </resource>
 *
 * `<type>` names the tree the file sits in, so the two are not
 * interchangeable. `<vendor>` is required in dist_database and optional in
 * image: a nested user sample pack carries it, a flat installed expansion
 * does not.
 *
 *   image/bruce/techno elements/techno elements.meta
 *     <?xml version="1.0" encoding="UTF-8" standalone="no" ?>
 *     <resource version="1.0.0.0">
 *       <vendor>bruce</vendor>
 *       <name>techno elements</name>
 *       <type>image</type>
 *     </resource>
 *
 * For that nested case both values are LOWERCASE and must match the folder
 * names exactly - unlike the flat expansion above, whose `<name>` is the
 * display name as NI writes it ("Amplified Funk").
 *
 * This generates them directly, which replaces the old approach of copying a
 * harvested file (that carried the donor library's name into every pack).
 */

export type ResourceType = "image" | "dist_database";

/** Third-party dist_database entries in the wild use 1.0.0.0. */
const DEFAULT_VERSION = "1.0.0.0";

/** XML text escaping - vendor and product names are user input. */
function esc(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

export interface MetaInput {
  /** Display name, properly cased (e.g. "SubLab"), not the folder name. */
  name: string;
  type: ResourceType;
  /**
   * Required for dist_database. Optional for image: supply it for a nested
   * user sample pack, where it must match the parent folder name, and leave
   * it off for a flat installed expansion.
   */
  vendor?: string | null;
  version?: string;
}

export function buildMeta(input: MetaInput): string {
  const version = input.version ?? DEFAULT_VERSION;
  const lines = [
    '<?xml version="1.0" encoding="UTF-8" standalone="no" ?>',
    `<resource version="${esc(version)}">`,
    "",
  ];

  if (input.type === "dist_database" && !input.vendor) {
    throw new Error("A dist_database .meta requires a vendor.");
  }
  if (input.vendor) {
    lines.push(`  <vendor>${esc(input.vendor)}</vendor>`, "");
  }

  lines.push(
    `  <name>${esc(input.name)}</name>`,
    "",
    `  <type>${input.type}</type>`,
    "",
    "</resource>",
    "",
  );

  return lines.join("\n");
}

export function metaBuffer(input: MetaInput): Buffer {
  return Buffer.from(buildMeta(input), "utf8");
}
