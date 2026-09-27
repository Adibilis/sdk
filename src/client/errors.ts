export class AdibilisApiError extends Error {
    override readonly name = 'AdibilisApiError';

    constructor(
        readonly status: number,
        readonly body: unknown,
        readonly path: string
    ) {
        // Deliberately excludes headers and config: this message can surface in a Next.js error
        // boundary, and the api key must never travel with it.
        super(`Adibilis API ${status} for ${path}`);
    }
}
