import "server-only";
// Settlement is captured by the database outbox; no synchronous grant.
export async function grantSettledBookingSpend(_draftAppId:string):Promise<void>{}
