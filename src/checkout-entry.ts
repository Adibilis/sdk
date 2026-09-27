// React-only entry. Kept OUT of the root entry so `@adbls/sdk` imports cleanly in a project
// with no React at all — otherwise the optional `react` peer is optional in name only, since a
// barrel re-export pulls it in eagerly. A non-React shop simply never imports this subpath.
export { CheckoutProvider, useCheckout } from './checkout/checkout-context.js';
export type {
    CheckoutContextValue,
    CheckoutStep,
    FormState,
    StripeSettings,
    TaxBreakdown,
} from './checkout/checkout-context.js';
