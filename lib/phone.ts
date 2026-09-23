/** Phone helpers for CRM search / duplicate detection */

export function normalizePhone(phone: string): string {
  return phone.replace(/[\s\-()]/g, "");
}

export function phonesMatch(a: string, b: string): boolean {
  const na = normalizePhone(a);
  const nb = normalizePhone(b);
  if (!na || !nb) return false;
  return na === nb;
}

export function formatPhoneDisplay(phone: string): string {
  const n = normalizePhone(phone);
  if (/^09\d{8}$/.test(n)) {
    return `${n.slice(0, 4)}-${n.slice(4, 7)}-${n.slice(7)}`;
  }
  return phone;
}
