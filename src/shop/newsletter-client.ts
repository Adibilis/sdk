import { z } from 'zod';
import type { AdibilisClient } from '../client/api-client.js';
import { shopCallHeaders } from '../subscription/checkout-client.js';
import type { ShopCallOptions } from '../subscription/checkout-client.js';

/** The languages core accepts for a sign-up: lower-case, exactly these — `de-CH` or `DE` is a 400. */
export type NewsletterLanguage = 'de' | 'fr' | 'it' | 'en';

const NEWSLETTER_LANGUAGES = ['de', 'fr', 'it', 'en'] as const satisfies readonly NewsletterLanguage[];

export interface NewsletterSignupRequest {
    firstname: string;
    lastname: string;
    email: string;
    /** Must be `true`: collect the visitor's consent before submitting. */
    consent: true;
    /** The honeypot input's raw value — a person leaves it empty. Forward it verbatim; never set it yourself. */
    website?: string;
    /** The visitor's language, sent as given — map a locale like `de-CH` to `de` yourself. */
    language?: NewsletterLanguage;
}

// Only what keeps an obviously incomplete sign-up from leaving the process; every other rule is core's.
const SignupPayloadModel = z.object({
    firstname: z.string().trim().regex(/\S/, 'firstname must not be blank'),
    lastname: z.string().trim().regex(/\S/, 'lastname must not be blank'),
    email: z.string().trim().email(),
    consent: z.literal(true, 'consent must be true: collect it before submitting'),
    website: z.string().optional(),
    language: z.enum(NEWSLETTER_LANGUAGES).optional(),
});

/**
 * Signs a visitor up for the newsletter. Core answers **202** with an empty body for a new address, a known one and one already
 * subscribed alike — and for a honeypot hit — so the page always says the same thing and never reveals who
 * is subscribed.
 *
 * `website` is the honeypot: render it as a hidden input a person leaves empty and forward its raw value. A non-blank `website`
 * skips every local check and is sent as-is, so a bot gets core's silent 202 rather than a client-side rejection that would
 * reveal the trap.
 *
 * Refused (each an `AdibilisApiError`; read its `status`): 400 validation, with the violations in `err.body`
 * (`NEWSLETTER_CONSENT_REQUIRED` for `consent: false`); 429 `TOO_MANY_REQUESTS` beyond 5 sign-ups a minute per visitor or 120
 * per shop server; 503 `NEWSLETTER_NOT_STORED` (with `Retry-After: 60`) when core could not store the sign-up — try again
 * later; 401/403 a missing, wrong or under-privileged WEBSITE key. A blank name, an address that is none, a `consent` other
 * than `true`, a `language` other than `de`, `fr`, `it` or `en`, or a `clientIp` that is no IP literal is a `ZodError` here,
 * before any request.
 */
export async function subscribeNewsletter(client: AdibilisClient, request: NewsletterSignupRequest, options: ShopCallOptions): Promise<void> {
    const headers = shopCallHeaders(options);
    const { firstname, lastname, email, consent, website, language } = request;
    const payload = { firstname, lastname, email, consent, website, language };
    await client.post<null>('/api/shop/newsletter', website?.trim() ? payload : SignupPayloadModel.parse(payload), { headers });
}
