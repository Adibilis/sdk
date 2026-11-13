import { describe, expect, it } from 'vitest';
import { AdibilisApiError } from '../src/client/errors';
import { resourceRefusalOf } from '../src/resource/refusal';

const PATH = '/api/website/resource/7';
const apiError = (status: number, body: unknown) => new AdibilisApiError(status, body, PATH);
const listed = (status: number, code: string, params: string[] = []) =>
    apiError(status, { error: 'x', errorList: { [code]: params }, url: `https://core.test${PATH}` });

describe('resourceRefusalOf', () => {
    it.each([
        ['an invalid session', listed(401, 'CUSTOMER_SESSION_INVALID'), { code: 'CUSTOMER_SESSION_INVALID' }],
        ['a closed module', listed(404, 'RESOURCES_MODULE_DISABLED', ['Resources module disabled']), { code: 'RESOURCES_MODULE_DISABLED' }],
        ['an unknown or unpublished resource', listed(404, 'RESOURCE_NOT_FOUND'), { code: 'RESOURCE_NOT_FOUND' }],
        ['an unknown file', listed(404, 'MEDIA_NOT_FOUND'), { code: 'MEDIA_NOT_FOUND' }],
        ['a locked resource', listed(403, 'RESOURCE_LOCKED'), { code: 'RESOURCE_LOCKED' }],
        ['a used-up budget', listed(429, 'TOO_MANY_REQUESTS'), { code: 'TOO_MANY_REQUESTS' }],
    ])('reads %s', (_name, error, refusal) => {
        expect(resourceRefusalOf(error)).toEqual(refusal);
    });

    it('reads a bare 401 as no refusal', () => {
        expect(resourceRefusalOf(apiError(401, { error: 'Unauthorized' }))).toBeNull();
    });

    it('reads a code under the wrong status as no refusal', () => {
        expect(resourceRefusalOf(listed(403, 'RESOURCE_NOT_FOUND'))).toBeNull();
    });

    it('reads anything but an AdibilisApiError as no refusal', () => {
        expect(resourceRefusalOf(new Error('boom'))).toBeNull();
        expect(resourceRefusalOf('RESOURCE_LOCKED')).toBeNull();
        expect(resourceRefusalOf(null)).toBeNull();
    });
});
