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
 * The two are NOT interchangeable: `<type>` names the tree the file sits in,
 * and only the dist_database one carries `<vendor>`. This generates them
 * directly, which replaces the old approach of copying a harvested file (that
 * carried the donor library's name into every pack).
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
  /** Required for dist_database, omitted for image. */
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

  if (input.type === "dist_database") {
    if (!input.vendor) {
      throw new Error("A dist_database .meta requires a vendor.");
    }
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
