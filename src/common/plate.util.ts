export function normalizePlate(plate: string): string {
  return plate.toUpperCase().replace(/[\s\-_]/g, '');
}

/**
 * Pakistani plate formats (after normalization — hyphens and spaces stripped):
 *
 *   Old format:  2–4 letters + 3–5 digits         e.g. LEF4869, ABC1234, ABCD12345
 *   New format:  2–4 letters + 2 digits + 3–4 digits  e.g. ABC121234, LHR024567
 *                (originally "ABC-12-1234" on the physical plate)
 *
 * Both collapse to: 2–4 leading letters followed by 5–8 digits total.
 * A simple unified regex covers both without needing to know which format.
 *
 * Intentionally excluded: diplomat plates, government plates, partial reads
 * with no digits, and readings that are pure noise (all-digit strings, etc.).
 */
const PLATE_REGEX = /^[A-Z]{2,4}\d{3,8}$/;

export function isValidPakistaniPlate(normalized: string): boolean {
  return PLATE_REGEX.test(normalized);
}
