/**
 * Ethiopian phone number formatting and validation utility
 * Supports formats:
 * - 0911234567 -> 251911234567
 * - 0711234567 -> 251711234567
 * - +251911234567 -> 251911234567
 * - 251911234567 -> 251911234567
 */

export function normalizeEthiopianPhone(phone: string): string {
  if (!phone) return "";
  // Remove all non-numeric characters except leading +
  let cleaned = phone.trim().replace(/[\s\-\(\)\.]/g, "");

  if (cleaned.startsWith("+")) {
    cleaned = cleaned.substring(1);
  }

  // If local format starting with 09 or 07 (10 digits)
  if (/^0[79]\d{8}$/.test(cleaned)) {
    return "251" + cleaned.substring(1);
  }

  // If local format without leading 0 (9 digits starting with 9 or 7)
  if (/^[79]\d{8}$/.test(cleaned)) {
    return "251" + cleaned;
  }

  // If already prefixed with 251 (12 digits)
  if (/^251[79]\d{8}$/.test(cleaned)) {
    return cleaned;
  }

  return cleaned;
}

export function isValidEthiopianPhone(phone: string): boolean {
  const normalized = normalizeEthiopianPhone(phone);
  return /^251[79]\d{8}$/.test(normalized);
}

export function displayEthiopianPhone(phone: string): string {
  const normalized = normalizeEthiopianPhone(phone);
  if (/^251([79]\d{2})(\d{3})(\d{3})$/.test(normalized)) {
    return normalized.replace(/^251([79]\d{2})(\d{3})(\d{3})$/, "+251 $1 $2 $3");
  }
  return phone;
}
