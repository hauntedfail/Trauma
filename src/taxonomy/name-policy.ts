export const TAG_NAME_VALIDATION_ERROR =
  "tag name may contain only Unicode letters, numbers, hyphen, and underscore";

export type TaxonomyNameValidationResult =
  | { ok: true; name: string }
  | { ok: false; error: string };

const tagNamePattern = /^[\p{L}\p{N}][\p{L}\p{M}\p{N}_-]{0,63}$/u;

export function normalizeTaxonomyName(name: string): string {
  return name.trim().normalize("NFC");
}

export function normalizeTaxonomyNameForLookup(name: string): string {
  return foldAsciiTaxonomyName(normalizeTaxonomyName(name));
}

function foldAsciiTaxonomyName(name: string): string {
  return name.replace(/[A-Z]/g, (character) => character.toLowerCase());
}

export function validateTagName(name: string): TaxonomyNameValidationResult {
  const normalizedName = normalizeTaxonomyName(name);
  if (normalizedName === "") {
    return { ok: false, error: "name must be a non-empty string" };
  }

  if (!tagNamePattern.test(normalizedName)) {
    return { ok: false, error: TAG_NAME_VALIDATION_ERROR };
  }

  return { ok: true, name: normalizedName };
}
