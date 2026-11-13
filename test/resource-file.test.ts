import { describe, expect, it, vi } from 'vitest';
import { createAdibilisClient } from '../src/client/api-client';
import { AdibilisApiError } from '../src/client/errors';
import { resourceRefusalOf } from '../src/resource/refusal';
import { resourceFile } from '../src/resource/resource-client';

const OPTIONS = { clientIp: '203.0.113.7' };
const BYTES = new Uint8Array([1, 2, 3, 4, 5]);

const clientAnswering = (response: () => Response) => {
    const fetchMock = vi.fn().mockImplementation(async () => response());
    return { client: createAdibilisClient({ baseUrl: 'https://core.test/', apiKey: 'k', fetch: fetchMock }), fetchMock };
};

const headersOf = (fetchMock: ReturnType<typeof vi.fn>) => fetchMock.mock.calls[0][1].headers as Record<string, string>;

const bytesOf = async (stream: ReadableStream<Uint8Array>) => new Uint8Array(await new Response(stream).arrayBuffer());

describe('resourceFile', () => {
    it('streams a whole file', async () => {
        const { client, fetchMock } = clientAnswering(() => new Response(BYTES, { status: 200, headers: { 'Content-Type': 'application/pdf' } }));

        const file = await resourceFile(client, 7, 31, OPTIONS);

        expect(file.status).toBe(200);
        expect(await bytesOf(file.body)).toEqual(BYTES);
        const [url, init] = fetchMock.mock.calls[0];
        expect(url).toBe('https://core.test/api/website/resource/7/file/31');
        expect(init.method).toBe('GET');
        expect(init.cache).toBe('no-store');
        expect(headersOf(fetchMock)['Accept']).toBe('*/*');
        expect(headersOf(fetchMock)['X-Shop-Client-Ip']).toBe('203.0.113.7');
        expect(headersOf(fetchMock)['X-API-Secret-Key']).toBe('k');
    });

    it('passes the range through and keeps the 206 headers', async () => {
        const { client, fetchMock } = clientAnswering(
            () =>
                new Response(BYTES, {
                    status: 206,
                    headers: {
                        'Content-Range': 'bytes 0-1023/5000',
                        'Accept-Ranges': 'bytes',
                        'Content-Length': '1024',
                        'Content-Type': 'video/mp4',
                    },
                })
        );

        const file = await resourceFile(client, 7, 31, { ...OPTIONS, range: 'bytes=0-1023' });

        expect(headersOf(fetchMock)['Range']).toBe('bytes=0-1023');
        expect(file.status).toBe(206);
        expect(file.headers).toMatchObject({
            'Content-Range': 'bytes 0-1023/5000',
            'Accept-Ranges': 'bytes',
            'Content-Length': '1024',
            'Content-Type': 'video/mp4',
        });
    });

    it('sends no range unless asked', async () => {
        const { client, fetchMock } = clientAnswering(() => new Response(BYTES, { status: 200 }));

        await resourceFile(client, 7, 31, OPTIONS);
        await resourceFile(client, 7, 31, { ...OPTIONS, range: '' });
        await resourceFile(client, 7, 31, { ...OPTIONS, range: null });

        expect(fetchMock).toHaveBeenCalledTimes(3);
        for (const call of fetchMock.mock.calls) expect(call[1].headers).not.toHaveProperty('Range');
    });

    it('drops every header outside the allow-list', async () => {
        const { client } = clientAnswering(
            () =>
                new Response(BYTES, {
                    status: 200,
                    headers: {
                        'Content-Type': 'application/pdf',
                        'Set-Cookie': 'JSESSIONID=1',
                        'X-Frame-Options': 'SAMEORIGIN',
                        'Access-Control-Allow-Origin': '*',
                        'Cache-Control': 'public, max-age=3600',
                    },
                })
        );

        const { headers } = await resourceFile(client, 7, 31, OPTIONS);

        const names = Object.keys(headers).map((name) => name.toLowerCase());
        expect(names).not.toContain('set-cookie');
        expect(names).not.toContain('x-frame-options');
        expect(names).not.toContain('access-control-allow-origin');
        expect(headers).toEqual({
            'Content-Type': 'application/pdf',
            'Cache-Control': 'private, no-store',
            'X-Content-Type-Options': 'nosniff',
            'Content-Security-Policy': "default-src 'none'",
        });
    });

    it("keeps core's content disposition", async () => {
        const { client } = clientAnswering(
            () => new Response(BYTES, { status: 200, headers: { 'Content-Disposition': 'inline; filename="guide.pdf"' } })
        );

        const { headers } = await resourceFile(client, 7, 31, OPTIONS);

        expect(headers['Content-Disposition']).toBe('inline; filename="guide.pdf"');
    });

    it('rejects a locked file with AdibilisApiError', async () => {
        const { client } = clientAnswering(
            () => new Response(JSON.stringify({ errorList: { RESOURCE_LOCKED: [] } }), { status: 403, headers: { 'Content-Type': 'application/json' } })
        );

        const error = await resourceFile(client, 7, 31, OPTIONS).catch((e: unknown) => e);

        expect(error).toBeInstanceOf(AdibilisApiError);
        expect(resourceRefusalOf(error)).toEqual({ code: 'RESOURCE_LOCKED' });
    });

    it('sends the session when one is given', async () => {
        const { client, fetchMock } = clientAnswering(() => new Response(BYTES, { status: 200 }));

        await resourceFile(client, 7, 31, { ...OPTIONS, customerSession: 'tok' });

        expect(headersOf(fetchMock)['X-Customer-Session']).toBe('tok');
    });

    it('rejects a 416 without reading the file', async () => {
        const cancel = vi.fn();
        const body = new ReadableStream<Uint8Array>({
            start(controller) {
                controller.enqueue(new Uint8Array(1_000_000));
            },
            cancel,
        });
        const { client } = clientAnswering(
            () => new Response(body, { status: 416, headers: { 'Content-Range': 'bytes */5000', 'Content-Type': 'video/mp4' } })
        );

        await expect(resourceFile(client, 7, 31, { ...OPTIONS, range: 'bytes=9000-' })).rejects.toMatchObject({
            name: 'AdibilisApiError',
            status: 416,
            body: null,
        });
        expect(cancel).toHaveBeenCalled();
    });
});
