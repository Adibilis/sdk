'use client';

import { createContext, useContext, useMemo, useState, type ReactNode } from 'react';

export type CheckoutStep = 'customer_info' | 'payment';

export interface FormState {
    isProcessing: boolean;
    isReady: boolean;
    step: CheckoutStep;
}

/**
 * The Payment Element is mounted in client-secret mode, so the secret is handed over up front.
 * There is deliberately no `amount`/`currency` here: core creates the order and the PaymentIntent,
 * so the browser never computes what to charge.
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
    onSuccess: () => void;
}

const CheckoutContext = createContext<CheckoutContextValue | null>(null);

const INITIAL_FORM_STATE: FormState = { isProcessing: false, isReady: false, step: 'customer_info' };

export function CheckoutProvider({ children, onSuccess }: { children: ReactNode; onSuccess: () => void }) {
    const [formState, setFormState] = useState<FormState>(INITIAL_FORM_STATE);
    const [stripe, setStripe] = useState<StripeSettings | null>(null);
    const [taxBreakdown, setTaxBreakdown] = useState<TaxBreakdown | null>(null);
    const [proceedToPayment, setProceedToPaymentState] = useState<(() => void) | null>(null);
    const [paymentCallback, setPaymentCallbackState] = useState<(() => void) | null>(null);

    const value = useMemo<CheckoutContextValue>(
        () => ({
            formState,
            setFormState,
            stripe,
            setStripe,
            taxBreakdown,
            setTaxBreakdown,
            proceedToPayment,
            // Wrapped in an updater: useState treats a bare function argument as a lazy initializer,
            // so storing a callback directly would call it instead of holding it.
            setProceedToPayment: (fn) => setProceedToPaymentState(() => fn),
            paymentCallback,
            setPaymentCallback: (fn) => setPaymentCallbackState(() => fn),
            onSuccess,
        }),
        [formState, stripe, taxBreakdown, proceedToPayment, paymentCallback, onSuccess]
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
