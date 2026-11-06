/** The preset fields a batch can set. Kept free of Node imports so the browser can use it. */
export const TAG_FIELDS = [
  "vendor",
  "bankchain",
  "types",
  "characters",
  "author",
  "comment",
] as const;
export type TagField = (typeof TAG_FIELDS)[number];
