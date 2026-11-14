import { describe, expect, it } from 'vitest';
import { SalutationModel } from '../src/client-entry';
import type { Salutation } from '../src/client-entry';
import type { Salutation as ServerSalutation } from '../src/server';
import type { CheckoutRequest, PropertyEnquiryRequest, PropertyLeadRequest } from '../src/server';

describe('salutation', () => {
    it('offers MR, MS and DIVERSE in that order', () => {
        expect(SalutationModel.options).toEqual(['MR', 'MS', 'DIVERSE']);
    });

    it('is accepted by every request that carries a person', () => {
        const diverse = 'DIVERSE' satisfies Salutation satisfies ServerSalutation;
        const billing = { salutation: diverse } satisfies Pick<NonNullable<CheckoutRequest['billingPerson']>, 'salutation'>;
        const delivery = { salutation: diverse } satisfies Pick<NonNullable<CheckoutRequest['deliveryPerson']>, 'salutation'>;
        const enquiry = { salutation: diverse } satisfies Pick<PropertyEnquiryRequest, 'salutation'>;
        const lead = { salutation: diverse } satisfies Pick<PropertyLeadRequest['contact'], 'salutation'>;
        expect([billing, delivery, enquiry, lead]).toHaveLength(4);
    });
});
