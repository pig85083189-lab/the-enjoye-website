export function isAuthUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value,
  );
}

export function assertOperationalStaffId(staffId: string): void {
  if (isAuthUuid(staffId)) {
    throw new Error("auth UUID must not be used as operational staffId");
  }
}
