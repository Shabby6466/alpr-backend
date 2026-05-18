export function normalizePlate(plate: string): string {
  return plate.toUpperCase().replace(/[\s\-_]/g, '');
}

/**
 * Pakistani plate formats:
 *   Punjab/KPK/Sindh/Baloch: 2–4 letters + 3–5 digits  (e.g. LEF4869, ABC123)
 *   Diplomat/govt plates are intentionally not filtered.
 */
const PLATE_REGEX = /^[A-Z]{2,4}\d{3,5}$/;

export function isValidPakistaniPlate(normalized: string): boolean {
  return PLATE_REGEX.test(normalized);
}
