import { NextResponse } from "next/server";

/**
 * Token-less webhook path is retired. LINE must POST the org-scoped public token URL.
 * Intentionally does not use the service role.
 */
export async function POST() {
  return NextResponse.json({ ok: false }, { status: 404 });
}

export async function GET() {
  return NextResponse.json({ ok: false }, { status: 404 });
}
