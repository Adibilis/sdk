import { AdibilisApiError } from '../client/errors.js';

export type ResourceRefusal =
    /** 401: the session expired, was revoked, or its person is no longer a customer. Clear the cookie and sign in again. */
    | { code: 'CUSTOMER_SESSION_INVALID' }
    /** 404: core's resources module is off — the resources site is closed. */
    | { code: 'RESOURCES_MODULE_DISABLED' }
    /** 404: no such resource, or it is not published (core does not tell which). */
    | { code: 'RESOURCE_NOT_FOUND' }
    /** 404: the resource has no such file. */
    | { code: 'MEDIA_NOT_FOUND' }
    /** 403: the file call of a resource the visitor's groups do not unlock. Show the sign-in. */
    | { code: 'RESOURCE_LOCKED' }
    /** 429: this visitor used up its budget. Wait; do not loop. */
    | { code: 'TOO_MANY_REQUESTS' };

const LISTED: Record<number, readonly ResourceRefusal['code'][]> = {
    401: ['CUSTOMER_SESSION_INVALID'],
    403: ['RESOURCE_LOCKED'],
    404: ['RESOURCES_MODULE_DISABLED', 'RESOURCE_NOT_FOUND', 'MEDIA_NOT_FOUND'],
    429: ['TOO_MANY_REQUESTS'],
};

/**
 * Core's refusal of a resource call in a form a satellite can act on, or `null` for anything else — rethrow that. Only a 401 that
 * names `CUSTOMER_SESSION_INVALID` means "sign in again": a 401 without it is a wrong WEBSITE key, which no sign-in fixes.
 */
export function resourceRefusalOf(error: unknown): ResourceRefusal | null {
    if (!(error instanceof AdibilisApiError)) return null;
    const body = error.body as { errorList?: Record<string, unknown> } | null;
    const errorList = body?.errorList ?? {};
    const listed = LISTED[error.status]?.find((code) => code in errorList);
    return listed === undefined ? null : { code: listed };
}
