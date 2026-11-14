import { describe, expect, it } from 'vitest';
import { SalutationModel } from '../src/client-entry';
import { SalutationModel as ServerSalutationModel } from '../src/server';

describe('salutation', () => {
    it('offers MR, MS and DIVERSE in that order', () => {
        expect(SalutationModel.options).toEqual(['MR', 'MS', 'DIVERSE']);
    });

    it('is re-exported from the server entry as the same model', () => {
        expect(ServerSalutationModel).toBe(SalutationModel);
        expect(ServerSalutationModel.options).toEqual(['MR', 'MS', 'DIVERSE']);
    });
});
