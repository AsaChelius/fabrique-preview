import { NextResponse } from "next/server";
import type { ContactFormData, ContactFormResponse } from "@/types/contact";

// TODO(Asa): Implement this endpoint.
//
// Requirements (see CLAUDE.md §4 "First task for Asa"):
//   - Parse + validate the body against `ContactFormData`. Do NOT trust the
//     client payload — re-validate server-side.
//   - Honeypot: reject if `body.website` is non-empty (silent 200 is fine).
//   - Rate-limit by IP (in-memory, Upstash, whatever you prefer).
//   - Send via Resend to Edouard's inbox (key in `RESEND_API_KEY`).
//   - Return `ContactFormResponse`: { ok: true } on success,
//     { ok: false, error, field? } on failure.
//   - Use 200 on success, 4xx on validation errors, 5xx on send failure.
//
// The UI side (Edouard) will POST JSON to /api/contact from a client component.
export async function POST(request: Request): Promise<NextResponse<ContactFormResponse>> {
  const _body = (await request.json().catch(() => null)) as ContactFormData | null;
  return NextResponse.json(
    { ok: false, error: "Contact endpoint not yet implemented." },
    { status: 501 },
  );
}
