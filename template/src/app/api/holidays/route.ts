import { fetchHolidays } from '@adbls/sdk/server';

import { adibilis } from '@/lib/adibilis';

// A route handler runs on the server, so it may hold the client — and therefore the key.
// The browser calls this; it never calls CORE directly.
export async function GET() {
    return Response.json(await fetchHolidays(adibilis()));
}
