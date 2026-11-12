export const SESSION_HEADER = 'X-Customer-Session';

/** The request init that sends the customer's session to core; empty without one, so the call is exactly as before. A session-priced answer is never cacheable. */
export function customerSessionInit(customerSession: string | null | undefined): { headers?: Record<string, string>; cache?: 'no-store' } {
    return customerSession ? { headers: { [SESSION_HEADER]: customerSession }, cache: 'no-store' } : {};
}
