import { z } from 'zod';
import type { AddressValidationMessages } from './messages.js';

// Schemas are built per-locale so validation messages match the active language.
// The SDK never bundles a language — every message is injected by the consuming site.
//
// Each field sets its message TWICE, and both are load-bearing: `.min(1, msg)` covers a present
// but empty value, while `{ error: msg }` covers the field being absent entirely. Without the
// second, a missing field falls back to zod's own English default ("Invalid input: expected
// string, received undefined") — which both hides the injected message and puts a hardcoded
// language into a package whose whole point is not to have one.
const required = (message: string) => z.string({ error: message }).min(1, message);

export function makeAddressSchema(v: AddressValidationMessages) {
    return z.object({
        firstname: required(v.firstNameRequired),
        lastname: required(v.lastNameRequired),
        company: z.string().optional(),
        address: required(v.streetRequired),
        city: required(v.cityRequired),
        postalCode: required(v.postalCodeRequired),
    });
}

// Billing may be in a different country from shipping, so it carries its own country field.
export function makeBillingAddressSchema(v: AddressValidationMessages) {
    return makeAddressSchema(v).extend({
        country: required(v.countryRequired),
    });
}

export type AddressFormData = z.infer<ReturnType<typeof makeAddressSchema>>;
export type BillingAddressFormData = z.infer<ReturnType<typeof makeBillingAddressSchema>>;
export type { AddressValidationMessages };
