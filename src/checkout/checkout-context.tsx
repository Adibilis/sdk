'use client';

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';

export type CheckoutStep = 'customer_info' | 'payment';

export interface FormState {
    isProcessing: boolean;
    isReady: boolean;
    step: CheckoutStep;
}

/**
 * What step 2 mounts the Payment Element with: the order (or subscription) already exists in core
 * and at Stripe, so Elements runs in client-secret mode. There is deliberately no `amount`/`currency`
 * here: core created the PaymentIntent, so the browser never computes what to charge.
 */
export interface StripeSettings {
    publishableKey: string;
    clientSecret: string;
}

export interface TaxBreakdown {
    subtotal: number;
    tax: number;
    total: number;
    taxRate: number;
    currency: string;
}

export interface CheckoutContextValue {
    formState: FormState;
    setFormState: (state: FormState) => void;
    stripe: StripeSettings | null;
    setStripe: (settings: StripeSettings | null) => void;
    taxBreakdown: TaxBreakdown | null;
    setTaxBreakdown: (breakdown: TaxBreakdown | null) => void;
    /** Set by the customer form, invoked by the payment step — the handoff between the two. */
    proceedToPayment: (() => void) | null;
    setProceedToPayment: (fn: (() => void) | null) => void;
    /** Set by the payment element, invoked once confirmation resolves. */
    paymentCallback: (() => void) | null;
    setPaymentCallback: (fn: (() => void) | null) => void;
    /**
     * Step 2 → step 1: drops the Stripe settings and the ready flag, keeps the tax breakdown and the
     * registered handlers. The shop keeps its form values (a `FormProvider` mounted above both steps)
     * and resubmits: the same reference for a retry or a corrected email, a new one for any other change.
     */
    goBack: () => void;
    onSuccess: () => void;
}

const CheckoutContext = createContext<CheckoutContextValue | null>(null);

const INITIAL_FORM_STATE: FormState = { isProcessing: false, isReady: false, step: 'customer_info' };

/**
 * The two-step checkout contract every satellite follows:
 *
 * 1. Step 1 (`step: 'customer_info'`) is the shop's own form. Submitting it calls the shop's route
 *    handler, which calls `startCheckout` / `startSubscriptionCheckout` — the order or subscription
 *    exists in core from this moment — and answers `publishableKey` + `clientSecret`.
 * 2. The shop calls `setStripe({ publishableKey, clientSecret })` and moves to `step: 'payment'`.
 *    Step 2 mounts the Payment Element in client-secret mode; step 1 is unmounted, not hidden.
 * 3. Editing is `goBack()` and a resubmit. Keep the reference for a plain retry and whenever the email
 *    changed (core re-binds the order with the full payload); mint a new one when the email is the
 *    same and anything else changed — core then replaces the buyer email's open checkout in place
 *    (same number). Core expires an untouched checkout
 *    thirty minutes after the last submit; the next submit then answers 409 `CHECKOUT_EXPIRED`
 *    (`checkoutExpiredOf`) — mint a new reference.
 * 4. "Pay" only confirms. The success page decides with `checkoutStatusOutcome`.
 */
export function CheckoutProvider({ children, onSuccess }: { children: ReactNode; onSuccess: () => void }) {
    const [formState, setFormState] = useState<FormState>(INITIAL_FORM_STATE);
    const [stripe, setStripe] = useState<StripeSettings | null>(null);
    const [taxBreakdown, setTaxBreakdown] = useState<TaxBreakdown | null>(null);
    const [proceedToPayment, setProceedToPaymentState] = useState<(() => void) | null>(null);
    const [paymentCallback, setPaymentCallbackState] = useState<(() => void) | null>(null);

    // Wrapped in an updater: useState treats a bare function argument as a lazy initializer, so
    // storing a callback directly would call it instead of holding it. Built once: satellites
    // register their handler from an effect that depends on this setter, so a setter that changed
    // identity on every update re-ran that effect forever and pinned the browser's main thread.
    const setProceedToPayment = useCallback((fn: (() => void) | null) => setProceedToPaymentState(() => fn), []);
    const setPaymentCallback = useCallback((fn: (() => void) | null) => setPaymentCallbackState(() => fn), []);
    const goBack = useCallback(() => {
        setFormState(INITIAL_FORM_STATE);
        setStripe(null);
    }, []);

    const value = useMemo<CheckoutContextValue>(
        () => ({
            formState,
            setFormState,
            stripe,
            setStripe,
            taxBreakdown,
            setTaxBreakdown,
            proceedToPayment,
            setProceedToPayment,
            paymentCallback,
            setPaymentCallback,
            goBack,
            onSuccess,
        }),
        [formState, stripe, taxBreakdown, proceedToPayment, setProceedToPayment, paymentCallback, setPaymentCallback, goBack, onSuccess]
    );

    return (
        <CheckoutContext.Provider value={value}>
            {children}
            {/*
                Fully transparent, covers everything, swallows every click while a confirmation is
                in flight. Without it a customer can double-submit or navigate mid-payment.
            */}
            {formState.isProcessing && (
                <div data-checkout-overlay className="fixed inset-0 z-[100] cursor-wait" aria-hidden="true" />
            )}
        </CheckoutContext.Provider>
    );
}

export function useCheckout(): CheckoutContextValue {
    const context = useContext(CheckoutContext);
    if (!context) {
        throw new Error('useCheckout must be used inside a <CheckoutProvider>');
    }
    return context;
}
