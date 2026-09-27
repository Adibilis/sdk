// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { act, render, renderHook, screen } from '@testing-library/react';
import { CheckoutProvider, useCheckout } from '../src/checkout/checkout-context';

const wrapper = ({ children }: { children: React.ReactNode }) => (
    <CheckoutProvider onSuccess={() => {}}>{children}</CheckoutProvider>
);

describe('CheckoutProvider', () => {
    it('starts on customer_info, not ready, not processing', () => {
        const { result } = renderHook(() => useCheckout(), { wrapper });
        expect(result.current.formState).toEqual({ isProcessing: false, isReady: false, step: 'customer_info' });
    });

    it('advances to the payment step', () => {
        const { result } = renderHook(() => useCheckout(), { wrapper });
        act(() => result.current.setFormState({ isProcessing: false, isReady: true, step: 'payment' }));
        expect(result.current.formState.step).toBe('payment');
    });

    it('holds stripe settings including the client secret', () => {
        const { result } = renderHook(() => useCheckout(), { wrapper });
        act(() => result.current.setStripe({ publishableKey: 'pk_test_1', clientSecret: 'cs_1' }));
        expect(result.current.stripe).toEqual({ publishableKey: 'pk_test_1', clientSecret: 'cs_1' });
    });

    it('holds a tax breakdown', () => {
        const { result } = renderHook(() => useCheckout(), { wrapper });
        const breakdown = { subtotal: 100, tax: 8.1, total: 108.1, taxRate: 8.1, currency: 'CHF' };
        act(() => result.current.setTaxBreakdown(breakdown));
        expect(result.current.taxBreakdown).toEqual(breakdown);
    });

    it('calls onSuccess through the context', () => {
        const onSuccess = vi.fn();
        const { result } = renderHook(() => useCheckout(), {
            wrapper: ({ children }) => <CheckoutProvider onSuccess={onSuccess}>{children}</CheckoutProvider>,
        });
        act(() => result.current.onSuccess());
        expect(onSuccess).toHaveBeenCalledOnce();
    });

    it('renders a click-swallowing overlay only while processing', () => {
        function Toggle() {
            const { formState, setFormState } = useCheckout();
            return <button onClick={() => setFormState({ ...formState, isProcessing: true })}>go</button>;
        }
        render(<CheckoutProvider onSuccess={() => {}}><Toggle /></CheckoutProvider>);

        expect(document.querySelector('[data-checkout-overlay]')).toBeNull();
        act(() => screen.getByText('go').click());
        expect(document.querySelector('[data-checkout-overlay]')).not.toBeNull();
    });

    it('exposes no deferred-intent api', () => {
        const { result } = renderHook(() => useCheckout(), { wrapper });
        expect(result.current).not.toHaveProperty('requestPaymentIntent');
        expect(result.current).not.toHaveProperty('paymentIntentRef');
    });

    // The hook is useless-but-silent outside a provider unless it throws: React returns the
    // context default, so every field would read as undefined at the point of use, not here.
    it('throws a clear error when used outside the provider', () => {
        expect(() => renderHook(() => useCheckout())).toThrow(/CheckoutProvider/);
    });

    // useState treats a bare function argument as a lazy initializer, so a callback stored
    // directly would be invoked instead of held. Pins that the setters wrap it.
    it('stores callbacks rather than invoking them', () => {
        const proceed = vi.fn();
        const { result } = renderHook(() => useCheckout(), { wrapper });

        act(() => result.current.setProceedToPayment(proceed));

        expect(proceed).not.toHaveBeenCalled();
        expect(result.current.proceedToPayment).toBe(proceed);
    });
});
