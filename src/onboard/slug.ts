export const MIN_NAME_LEN = 1;
export const MAX_NAME_LEN = 24;
export const MIN_SLUG_LEN = 3;
export const MAX_SLUG_LEN = 30;

export type SlugValidation =
  | 'valid'
  | 'too-short'
  | 'too-long'
  | 'invalid-chars'
  | 'invalid-edge';

const SLUG_ALLOWED_RE = /^[a-z0-9-]+$/;
const SLUG_EDGE_RE = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/;

export function createSessionFallbackId(): string {
  const digits = Math.floor(1000 + Math.random() * 9000);
  return String(digits);
}

export function sanitizeSlugInput(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/-{2,}/g, '-')
    .slice(0, MAX_SLUG_LEN);
}

export function suggestSlugFromName(name: string, fallbackId: string): string {
  const normalized = name
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-');

  if (normalized.length >= MIN_SLUG_LEN) {
    return normalized.slice(0, MAX_SLUG_LEN).replace(/-+$/g, '') || `cat-${fallbackId}`;
  }

  if (normalized.length > 0) {
    const padded = `${normalized}-cat`;
    if (padded.length >= MIN_SLUG_LEN) {
      return padded.slice(0, MAX_SLUG_LEN);
    }
  }

  return `cat-${fallbackId}`;
}

export function validateSlug(slug: string): SlugValidation {
  if (slug.length < MIN_SLUG_LEN) return 'too-short';
  if (slug.length > MAX_SLUG_LEN) return 'too-long';
  if (!SLUG_ALLOWED_RE.test(slug)) return 'invalid-chars';
  if (!SLUG_EDGE_RE.test(slug) || slug.includes('--')) return 'invalid-edge';
  return 'valid';
}

export function validateCatName(name: string): boolean {
  const trimmed = name.trim();
  return trimmed.length >= MIN_NAME_LEN && trimmed.length <= MAX_NAME_LEN;
}

/**
 * M3 stub: availability check always reports available until Supabase lands in M4.
 */
export function checkSlugAvailability(_slug: string): Promise<boolean> {
  return Promise.resolve(true);
}
