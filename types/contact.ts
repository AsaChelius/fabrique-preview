/**
 * Shared types for the contact form.
 *
 * Frontend (Edouard) imports these to shape the client component + form state.
 * Backend (Asa) imports these to validate the incoming payload and shape the
 * response.
 *
 * If either side needs a change here, coordinate — this is the contract.
 */

export type ContactFormData = {
  name: string;
  email: string;
  message: string;
  /** Honeypot — frontend leaves this empty. Non-empty = bot, backend drops it. */
  website?: string;
};

export type ContactFormResponse =
  | { ok: true }
  | { ok: false; error: string; field?: keyof ContactFormData };
