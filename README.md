# @adbls/sdk

Satellite-site SDK for Adibilis CORE. Everything an Adibilis website needs to talk to the ERP:
a server-side API client, a zod form layer, the order model, the checkout step machine, the
holidays client, and the properties listing/lead flow.

It exists so a shop site is mostly configuration and design. Before it, each site carried its own
copy of the ERP integration, and those copies drifted.

## The two entry points

The export map is the architectural boundary of this package, not a convenience:

| Import | Contains | Safe in a browser bundle |
|---|---|---|
| `@adbls/sdk` | forms, order model, holidays, product image/price helpers, schedule and portal helpers | **yes** |
| `@adbls/sdk/checkout` | the React checkout context | **yes** |
| `@adbls/sdk/server` | the API client, the checkout, shop catalog, newsletter sign-up, subscription, customer portal and properties calls — **holds the WEBSITE key and customer sessions** | **no — server only** |

Plus `@adbls/sdk/checkout` for the React checkout context — a separate subpath so the root entry
imports cleanly in a project with no React at all.

A satellite that imports the wrong one gets a **build error**, not a leaked key. The export map routes
`./server` through the `browser` condition to a module that refuses to load:

```
Error: The export createAdibilisClient was not found in module
       .../dist/server-in-browser-error.js [app-client]
  Client Component Browser:
    ./src/app/your-component.tsx
```

The `browser` condition is understood by every major bundler, so this works in Next, Vite and webpack
alike — and, unlike React's `server-only` marker, it leaves the server entry usable from a plain Node
server.

Verified against a real Next build in `template/`, not asserted. Two guards, covering two different
mistakes:

- **The `browser` export condition** stops a *consumer* bundling the server entry into a client
  component.
- **`test/boundary.test.ts`** stops the *SDK itself* re-exporting the client through the browser
  entry, by walking the built `dist/` import graph.

## Checkout

The payment integration is server-side calls on `@adbls/sdk/server` plus Stripe Elements in the
browser, in **two steps**: step 1 is the shop's own form, step 2 is the Payment Element alone. The
order — and its Stripe invoice — comes into being **when the buyer leaves step 1**; until then a
**preview** prices the cart and creates nothing. "Pay" only confirms. The React side of the contract
is documented on `CheckoutProvider` in `@adbls/sdk/checkout` (`goBack()` for the way back).

```typescript
import {
    createAdibilisClient, previewCheckout, startCheckout, amountChangedOf, productUnavailableOf,
    checkoutExpiredOf, checkoutPaymentInProgressOf, getOrderStatus,
} from '@adbls/sdk/server';
import { checkoutStatusOutcome } from '@adbls/sdk';

const core = createAdibilisClient({ baseUrl: process.env.ADIBILIS_BASE_URL!, apiKey: process.env.ADIBILIS_API_KEY! });
const request = {
    order,                                   // OrderIngestRequest; validated with the generated zod schema
    returnUrl: 'https://shop.example/checkout/return?ref=' + order.externalRef,
};

// 1. Whenever the cart, country or an address field that affects tax changes: price it.
//    Nothing is created. amount/taxAmount are major units, vatRate is null for mixed rates.
const preview = await previewCheckout(core, request);
// preview.amount, preview.taxAmount, preview.vatRate, preview.currency (lower-case), preview.publishableKey

// 2. When the buyer leaves step 1: create the order and its invoice, refusing if the total moved since the preview.
try {
    const { clientSecret, publishableKey } = await startCheckout(core, { ...request, expectedAmount: preview.amount });
    // to the browser: mount Elements with { clientSecret } and loadStripe(publishableKey); on "Pay":
    // stripe.confirmPayment({ elements, confirmParams: { return_url } })
} catch (error) {
    if (checkoutExpiredOf(error)) { /* the reference names an expired order: mint a new one, say the reservation lapsed, back to step 1 */ }
    else if (checkoutPaymentInProgressOf(error)) { /* a payment for this email is still processing: say so, let the buyer retry in a minute */ }
    else if (amountChangedOf(error) !== null) { /* core voided the invoice: preview again, show the new amount, back to step 1 under a NEW reference */ }
    else if (productUnavailableOf(error) !== null) { /* nothing was created: "not available for delivery to <country>", remove or mark the line */ }
    else throw error;
}

// 3. From your success page's route handler: the truth is core's, not the browser's.
const { orderStatus } = await getOrderStatus(core, order.externalSource, order.externalRef);
switch (checkoutStatusOutcome(orderStatus)) {
    case 'paid':    // the webhook landed: done
    case 'expired': // EXPIRED or CANCELLED — can never be paid: stop polling, send the buyer to the cart
    case 'pending': // keep polling (every ~2 s, for about a minute, then "still confirming — reload")
}
```

**One open checkout per buyer email per shop.** What `(externalSource, externalRef)` and the
billing email mean to core on a resubmit after `goBack()`:

| the shop sends | core does |
|---|---|
| the same reference, the same email | a **retry**: the stored order and invoice are resumed. After a declined card the new payload is ignored; before any attempt only the addresses, fulfilment and pickup site refresh and the stored lines are re-priced. Lines, quantities, dates and notes are **not** applied. |
| the same reference, a corrected email | the order is **re-bound** to the new email with the full payload (unless a payment is already moving: a retry). |
| a new reference, the same email | that email's open, unpaid order is **replaced in place** — same order number, old invoice voided — with the full payload. Nothing is left behind to expire. |

So the rule for the shop: **whenever the email changed, keep the reference** — with or without other
changes, core re-binds the order with the full payload; a plain retry (another card) keeps it too;
mint a **new** one only when the email is unchanged and anything else in the payload changed
(flora and codonis-shop keep the last reference with the email and a fingerprint of the payload
without it). A declined card retried with another card never produces a second order or charge, and
a changed cart never leaves an abandoned order behind. Two more cases spend the reference: a 409
`CHECKOUT_AMOUNT_CHANGED` (retrying the old one re-invoices the old total) and a "Pay" that Stripe
refused for anything but a card, validation or 3-D Secure failure (the invoice is gone — go back to
step 1 and resubmit under a new one).

**Thirty minutes.** Core expires a checkout the buyer has not submitted again for thirty minutes
(status `EXPIRED`): the invoice is voided at Stripe, and an automation rule in the ERP can mail the
buyer. A submit under that reference answers 409 `CHECKOUT_EXPIRED` (`checkoutExpiredOf`): mint a
new reference, tell the buyer the reservation lapsed, send the checkout again. A Stripe error on
"Pay" that is not a `card_error` or `validation_error` (a voided invoice, an unexpected intent state)
is handled the same way: back to step 1, resubmit under a new reference. While the email's open payment is still being
processed (an asynchronous method), a new cart is refused with 409 `CHECKOUT_PAYMENT_IN_PROGRESS`
(`checkoutPaymentInProgressOf`); nothing was created.

**Elements in deferred mode** is for a shop that must show the card form before any order exists:
mount Elements from the preview — `loadStripe(preview.publishableKey)` and
`<Elements options={{ mode: 'payment', amount: Math.round(preview.amount * 100), currency: preview.currency }}>`
(`amount` in minor units) — and on "Pay" call `elements.submit()`, then `startCheckout`, then
`stripe.confirmPayment({ elements, clientSecret, ... })`. A checkout opened this way is created on
"Pay", so the ERP never sees an abandoned one. The publishable key follows the currency, so it can
differ between a CHF and a EUR cart.

The preview's order fields (`orderId`, `clientSecret`, `invoiceId`, ...) are all `null` and
`preview` is `true`. It is validated and refused like `startCheckout` — same endpoint, so
`returnUrl` is required here too. With automatic tax on, core taxes the order's own address, never
one stored on a known buyer: the delivery person's address when the order has one (goods are
shipped), otherwise the billing person's. Send the preview the same delivery and billing addresses
the real checkout will carry; only the country is required. A Stripe rejection of the address
(e.g. `customer_tax_location_invalid` where a postal code is needed) surfaces as a 400
`PAYMENT_PROVIDER_ERROR`.
`expectedAmount` is optional; without it core does not check the total.

The preview refuses a line no distributor routed to the buyer's country can ship exactly as the
checkout does (409 `SHOP_PRODUCT_NOT_AVAILABLE`, read with `productUnavailableOf`), so the shop
learns it before the buyer leaves step 1. `country` is `null` when the order named no country. A
resumed checkout is not checked again: its stock was decided when the order was created.

Core, not the shop, holds the Stripe secret key, receives the webhook, marks the order paid and
mails the buyer. The shop keeps only `@stripe/stripe-js` / `@stripe/react-stripe-js`, and
`returnUrl` must sit on the shop URL (or an allowed extra origin) configured in core's payment
settings.

**`cancellationUrl` is optional.** Pass an absolute URL on an allowed shop origin
(`cancellationUrl: 'https://kaemo.ch/stornieren'`) and core mails the buyer `<cancellationUrl>?token=…`
so they can cancel the order from your page (see "Order cancellation"). A URL on an origin core does
not allow answers 400 `SHOP_ORIGIN_NOT_ALLOWED`, exactly like a bad `returnUrl`: a setup error, not a
`checkoutRefusalOf` code.

### Discounts: a code field, delivery lines, open prices

Core owns every discount; the shop shows what core answers and never recomputes a total. The order
carries the buyer's code as `order.discountCode`, and the preview and the checkout take an optional
last argument `{ customerSession }` (see "Prices for a signed-in customer" under Shop catalog).

```typescript
import { headers } from 'next/headers';
import { previewCheckout, startCheckout, checkoutRefusalOf, clientIpOf } from '@adbls/sdk/server';

const withCode = { ...request, order: { ...order, discountCode: 'SPRING' } };   // build it once: preview and start must carry the same code
const visitor = { customerSession, clientIp: clientIpOf(await headers()) };      // the buyer's IP literal as your server saw it
const preview = await previewCheckout(core, withCode, visitor);
// preview.discountTotal — everything the buyer saves, major units: every automatic discount (also ones open to everyone, and free delivery) plus the code; 0 without any (always present)
// preview.discountCode — the code core applied; preview.discountCodeRefusal — why it was NOT applied (a DiscountCodeRefusal, or absent)
// preview.amount is already the discounted total: show it, send it as expectedAmount

try {
    await startCheckout(core, { ...withCode, expectedAmount: preview.amount }, visitor); // without the code core prices without it: 409 CHECKOUT_AMOUNT_CHANGED
} catch (error) {
    const refusal = checkoutRefusalOf(error); // null for anything else: rethrow
    // CHECKOUT_AMOUNT_CHANGED → preview again, show refusal.amount (also when the session lapsed between preview and start);
    // CHECKOUT_EXPIRED, CHECKOUT_PAYMENT_IN_PROGRESS, SHOP_PRODUCT_NOT_AVAILABLE → as above;
    // DISCOUNT_CODE_REFUSED → refusal.reason, the code field's error (nothing was created);
    // BOOKING_DATE_CANCELLED → the studio cancelled that class date: drop the line, refusal.productId / refusal.startAt name it
    //   (both `null` when core's answer carried none); re-read the cancelled dates (see Shop catalog);
    // SHOP_PRODUCT_NOT_FOUND → a catalog line's product is not listed any more; SHOP_PRODUCT_NOT_PRICED → refusal.productId has no price in refusal.currency;
    // SHOP_PRODUCT_PRICE_OUT_OF_RANGE → refusal.productId: the chosen open price is off the product's range or step;
    // ORDER_DELIVERY_LINE_WITH_PRODUCT → a delivery line also named a product (a bug in the cart builder)
    // TOO_MANY_REQUESTS → this visitor used up their budget: wait, do not loop
}
```

**Pass `clientIp` and preview on submit.** Give every `previewCheckout`, `startCheckout` and
`getOrderStatus(core, source, ref, { clientIp })` that carries a code field the visitor's IP from your
request (an IPv4 or IPv6 literal; anything else is a `ZodError`). Core allows 10 checkout calls per
visitor a minute and counts 10 wrong codes per visitor per 10 minutes; without `clientIp` all visitors
share the shop's budget, so one guesser locks codes for everyone (429, `TOO_MANY_REQUESTS`). Preview
when the buyer submits or applies the code, never on every keystroke: each partial code is a wrong one.

**A preview does not throw for a bad code.** It prices the cart without the discount and reports why
in `discountCodeRefusal`; the real checkout refuses the same code with 409 `DISCOUNT_CODE_REFUSED`
and creates nothing (except `NOT_BETTER`, which is never refused: see the table). `checkoutRefusalOf` reads the one-time checkout's refusals, `reason` being `null`
for a reason this SDK version does not know (still a refused code: show a generic message). Wording
is the shop's; English examples:

| `DiscountCodeRefusal` | meaning | suggested wording |
|---|---|---|
| `UNKNOWN` | no such code | "This code does not exist." |
| `DISABLED` | the code was switched off | "This code is not active." |
| `NOT_YET_VALID` | its start date is in the future | "This code is not valid yet." |
| `EXPIRED` | its end date has passed | "This code has expired." |
| `USED_UP` | its redemption limit is reached (a generated single-use code already taken) | "This code has been used up." |
| `ALREADY_USED` | this buyer already redeemed it (once per customer) | "You have already used this code." |
| `WRONG_CURRENCY` | a fixed-amount code in another currency than the order | "This code does not apply to this currency." |
| `BELOW_MINIMUM` | the order total is under the code's minimum | "Your order is below this code's minimum." |
| `NOT_APPLICABLE` | the code is for something else (another target such as subscriptions) or no line of the cart qualifies | "This code does not apply to the items in your cart." |
| `NOT_BETTER` | a discount the buyer already gets (their own, or free delivery already given) is at least as good; never a 409: the preview and the real checkout both report it as `discountCodeRefusal` and the checkout charges without the code | "Your current discount is already better." |
| `ZERO_TOTAL` | the code would bring the total below the currency's minimum charge (CHF 0.50), not only to zero (a 409 on the checkout, `discountCodeRefusal` on the preview) | "This code cannot cover the whole order." |
| `RECIPIENT_ONLY` | the code was issued to a different person | "This code is reserved for another customer." |
| `NO_DELIVERY` | a free-delivery code on a cart with no delivery line | "This code needs a delivery charge in the cart." |

**Delivery lines.** A delivery charge is an order line with `delivery: true` and **no** `productId`
(a line that names both is refused with 400 `ORDER_DELIVERY_LINE_WITH_PRODUCT`): a plain charge core
can recognise. A free-delivery code takes that line off, so a shop that wants to offer one must send its
delivery as such a line; a cart without one answers the code `NO_DELIVERY`.

**A code needs a catalog line.** Core applies a one-time code only to a cart with at least one catalog (`productId`) line; a cart of external lines only answers every code `NOT_APPLICABLE`.

**Open-price lines.** For a product with `openPrice` the buyer chooses the price: send it as the
line's `unitPrice` together with the `productId`. Core requires it on such a line, and refuses one outside the
product's range or step with 400 `SHOP_PRODUCT_PRICE_OUT_OF_RANGE`. Check it first with
`isValidOpenPrice(range, chosen)` (see Shop catalog) so the buyer never meets the 400.

**In the React tree** `useCheckout()` carries the code's outcome so the code field and the totals
share one place: `discount` (`{ code, total, refusal } | null`, the `CheckoutDiscount` type) and
`setDiscount(...)`, which the shop calls with the preview's `discountCode`, `discountTotal` and
`discountCodeRefusal`. `goBack()` clears it, because the resubmit prices it again.

### The buyer's document language

Send `billingPerson.language` (`DE`, `FR`, `IT` or `EN`) on `startCheckout` and `startSubscriptionCheckout`. Core stores it as a
new customer's document language, which their invoices and mails then use. A contact that already has a language keeps it.
`customerLanguage` picks the value: the language the site is shown in, else the browser's most preferred supported language
(`Accept-Language` read by `q` weight, not by position), else `undefined`. On `undefined` leave the field out and core uses its
default. A core before 1.9.26 ignores the field.

```typescript
import { customerLanguage } from '@adbls/sdk/server';

const language = customerLanguage({
    locale: activeLocale,                                 // the language picker's or route's value
    acceptLanguage: request.headers.get('accept-language'),
});
billingPerson.language = language;                        // `undefined` is omitted from the request
```

A site with one fixed language leaves `locale` out, so the browser's language counts:

```typescript
const language = customerLanguage({ acceptLanguage: request.headers.get('accept-language') });
```

In the browser, `browserCustomerLanguage` from `@adbls/sdk` reads `navigator.languages` instead of the header:

```typescript
import { browserCustomerLanguage } from '@adbls/sdk';

const language = browserCustomerLanguage({ locale: activeLocale, languages: navigator.languages });
```

Both helpers return upper-case `DE|FR|IT|EN`; `subscribeNewsletter` takes the lower-case `NewsletterLanguage`:

```typescript
import { type NewsletterLanguage } from '@adbls/sdk/server';

const newsletterLanguage = language?.toLowerCase() as NewsletterLanguage | undefined;
```

### The form under a phone keyboard

Phones open the keyboard over the page without making the page any longer, so the last fields of
a long checkout form end up unreachable, and a field the browser scrolls "into view" lands right
on the keyboard's edge with nothing visible below it. `useKeyboardClearance` (on
`@adbls/sdk/checkout`) fixes both for whatever form you hand it:

```tsx
'use client';
import { useRef } from 'react';
import { useKeyboardClearance } from '@adbls/sdk/checkout';

function CheckoutForm() {
    const form = useRef<HTMLDivElement>(null);
    // Place a focused field 48px under the sticky header: room for its label
    useKeyboardClearance(form, { offsetTop: () => headerHeight() + 48 });
    return <div ref={form}>…</div>;
}
```

```css
/* On the page: whatever bottom padding you have, plus the keyboard while it is open */
.checkout { padding-bottom: calc(10rem + var(--keyboard-height, 0px)); }
```

While a keyboard is open, `--keyboard-height` on `<html>` is its height (measured from the visual
viewport; a pinch-zoom is not a keyboard), so the page gains exactly the scroll room it needs. On
each focus inside the container the field is scrolled to `offsetTop` once the keyboard has
settled, never before, so the browser's own scroll does not fight it. It does nothing on a desktop.
Verified on iOS Safari and Chrome Android, both of which keep `fixed` elements in the layout
viewport, behind the keyboard — a fixed bottom bar stays out of the way.

## The Anrede

Every person a shop collects carries a `salutation`: `MR`, `MS` or `DIVERSE` (Herr, Frau, Divers). `SalutationModel` (from `@adbls/sdk`
and `@adbls/sdk/server`) is the one list; render `SalutationModel.options` in that order and word each value in the site's own language.

`makeAddressSchema` and `makeBillingAddressSchema` require it, so a form cannot submit without a choice. The message for a missing
one is `salutationRequired`, the seventh message of `AddressValidationMessages` next to the six address ones.

```typescript
import { SalutationModel, makeAddressSchema, type Salutation } from '@adbls/sdk';

// the site's own words, in each language it offers: the SDK bundles none
const salutationWords: Record<Salutation, string> = { MR: 'Herr', MS: 'Frau', DIVERSE: 'Divers' };

const schema = makeAddressSchema({ ...siteMessages, salutationRequired: 'Bitte eine Anrede wählen.' });

const choices = SalutationModel.options.map((value) => ({ value, label: salutationWords[value] }));
```

`siteMessages` and `salutationWords` come from the site's own translations; typing the words as `Record<Salutation, string>` makes the
compiler insist that all three values are worded.

The wire models keep `salutation` optional, and the SDK sends it wherever a person goes to core: the checkout billing and delivery
persons, the portal's `changeDeliveryPerson`, `subscribeNewsletter`, `submitPropertyEnquiry` and the contact of
`submitPropertyLead`. The portal's address read (`CustomerAddress`) returns it too. A later core release will require it on these
requests, so a shop that collects it now does not break then.

## Subscriptions

A subscription is sold through core the way an order is: core owns the plan, the delivery schedule
and the deliveries, Stripe bills each period **in advance**. The shop lists what core lists, lets
the buyer choose a delivery rhythm, previews the first charge and opens the checkout when the buyer
leaves step 1 (the same two steps as an order; "Subscribe" only confirms). Needs a core release with
the subscription checkout.

```typescript
// server side — route handlers
import {
    createAdibilisClient, fetchSubscriptionPlans, previewSubscriptionCheckout, startSubscriptionCheckout,
    getSubscriptionStatus, subscriptionCheckoutRef, subscriptionCheckoutRefusalOf, clientIpOf,
} from '@adbls/sdk/server';
import type { SubscriptionCheckoutRequest } from '@adbls/sdk/server';
// browser-safe helpers — usable in the cadence chooser too
import { isDynamicEntry, validateScheduleChoice, validFirstDeliveryDates, todayIn, dynamicUnitAmount } from '@adbls/sdk';

const entries = await fetchSubscriptionPlans(core);  // the dynamic entry first (if enabled), then the listed plans
const entry = entries.find(isDynamicEntry)!;          // "Subscribe this order": no plan, no price, plan fields null

// The buyer composes `schedule` within entry.scheduleDefinition. Check it the way core will:
validateScheduleChoice(entry.scheduleDefinition, schedule);        // false → core: 400 SUBSCRIPTION_SCHEDULE_NOT_ALLOWED
const startDates = validFirstDeliveryDates(entry, schedule, todayIn()); // [] unless the entry offers a start date

const terms = {
    dynamic: { unitAmount: Number(dynamicUnitAmount(lines)), vatRate: 2.6, priceMode: 'BRUTTO', lineItems: lines },
    currency: 'CHF',
    schedule,                                   // a SchedulePattern
    startDate: chosenStartDate,                 // omit to start now
    configuration: { colours: ['red'] },        // your own object; core stores it, the portal hands it back
    configurationText: 'Red bouquet, with card', // what orders, mails and the ERP show
    billingPerson, deliveryPerson,
    externalSource: 'flora',
    returnUrl: 'https://shop.example/subscribe/return',
} satisfies Omit<SubscriptionCheckoutRequest, 'externalRef'>;
const externalRef = await subscriptionCheckoutRef(cart.id, terms); // same cart → same ref; changed cart → new ref
const visitor = { clientIp: clientIpOf(request.headers) };          // the buyer's IP literal as your server saw it

// A preview is a checkout call: it counts against the visitor's 10 a minute. Preview once, before "Subscribe", and price the live
// line from dynamicPeriodAmount(...) instead of previewing on every change.
const preview = await previewSubscriptionCheckout(core, { ...terms, externalRef }, visitor);
// preview.amount — the first charge; preview.billingInterval/-Count; preview.firstDeliveryAt; preview.publishableKey

try {
    const started = await startSubscriptionCheckout(core, { ...terms, externalRef, expectedAmount: preview.amount }, visitor);
    // to the browser: started.clientSecret, started.secretKind, started.publishableKey
} catch (error) {
    const refusal = subscriptionCheckoutRefusalOf(error); // null for anything else: rethrow
    // SUBSCRIPTION_AMOUNT_CHANGED → preview again, show refusal.amount; SUBSCRIPTION_CHECKOUT_EXPIRED and
    // SUBSCRIPTION_CHECKOUT_CHANGED → start over with a NEW cart.id; SUBSCRIPTION_ALREADY_ACTIVE → it went through: show success;
    // SUBSCRIPTION_PLAN_NOT_AVAILABLE → not available for delivery to refusal.country;
    // SUBSCRIPTION_START_DATE_INVALID → refusal.earliest; TOO_MANY_REQUESTS → wait, then try again;
    // CHECKOUT_PAYMENT_IN_PROGRESS → a payment for this email is still processing, let the buyer retry in a minute
}

// the return page: core's word, not the browser's. Status reads are limited to 60 a minute per visitor: poll every ~3 s, for at
// most 2 minutes, and stop on a final status: ACTIVE (done), CANCELLED or EXPIRED (can never be paid — say the reservation
// lapsed, rotate the cart reference, link to the cart).
const { status, firstPaymentStatus } = await getSubscriptionStatus(core, 'flora', externalRef, visitor);
```

**In the browser.** `secretKind` says which Stripe.js call takes the secret — `confirmMethodOf`
(from `@adbls/sdk`) maps it: `PAYMENT` → `stripe.confirmPayment`. Every checkout charges its first
cycle now, with a start date too: the deliveries begin on that date, the subscription is active as
soon as the payment went through, and the next charge follows a lead time before the second cycle's
first delivery (`preview.nextBillingAt`). `SETUP` → `stripe.confirmSetup` comes back only when a
start-date checkout that a core release before 1.9.7 opened (card saved, nothing charged) is
resumed; the portal's card change is the only other SetupIntent. Before "Subscribe", mount Elements
in deferred mode from the preview, with or without a start date:
`{ mode: 'subscription', amount: Math.round(preview.amount * 100), currency: preview.currency.toLowerCase() }`.
Core sends the currency upper-case (`CHF`); Stripe wants it lower-case.

**What core holds you to:**

- **`expectedAmount` is required** — send `preview.amount`. Core quotes it before it creates
  anything and refuses a different first charge with 409 `SUBSCRIPTION_AMOUNT_CHANGED`.
  `dynamicPeriodAmount(unitAmount, schedule)` is the *price* line ("50.00 every week" with
  `describeBilling`); it is not the charge — a NETTO cart adds VAT and Stripe Tax decides under
  automatic tax. Use it for the live price line while the buyer changes the cart, and preview once
  before "Subscribe": previews share the 10-checkouts-a-minute budget of a real start.
- **The reference follows the cart.** The same `(externalSource, externalRef)` resumes an unpaid
  checkout (a declined card retried with another), but only with the same terms; other terms are
  409 `SUBSCRIPTION_CHECKOUT_CHANGED`. `subscriptionCheckoutRef(cartRef, terms)` does this for you:
  it appends a fingerprint of the terms to your cart reference (at most `MAX_CART_REF_LENGTH`
  characters). `configuration` counts as the exact string core stores — build the object the same
  way each time. With the helper, a 409 `SUBSCRIPTION_CHECKOUT_CHANGED` means the plan itself changed
  in core: deriving again gives the same reference, so the cart needs a new `cartRef`. Core expires
  an unpaid checkout thirty minutes after the buyer last submitted it (status `EXPIRED`, the Stripe
  subscription cancelled); its reference is then spent (409 `SUBSCRIPTION_CHECKOUT_EXPIRED`) and the
  cart needs a new `cartRef`. The same answer comes for a row Stripe dropped or core cancelled after
  its post-create amount check. `SUBSCRIPTION_ALREADY_ACTIVE` is the opposite: the reference became
  a subscription, show success. **One open checkout per buyer email:** a changed cart under a new
  reference replaces the email's open `INCOMPLETE` subscription in place (same number), and while the
  email's first payment is still processing a new cart is refused with 409 `CHECKOUT_PAYMENT_IN_PROGRESS`.
- **Refusals a buyer can hit at run time**, all read by `subscriptionCheckoutRefusalOf`: 400
  `SUBSCRIPTION_DYNAMIC_DISABLED` (core offers no dynamic entry), 404 `SHOP_SUBSCRIPTION_PLAN_NOT_FOUND`
  (the plan was unlisted or archived since you read the catalog), 400 `SUBSCRIPTION_START_DATE_NOT_ALLOWED`
  (not one of `validFirstDeliveryDates`) and 429 `TOO_MANY_REQUESTS`. Re-read the catalog for the
  first two; do not retry the last in a loop.
- **Out of stock (core ≥ v1.9.14):** a plan can name products each delivery takes from stock. When the
  first delivery cannot be served to the buyer's delivery country (a "stop at 0" product its distributor
  has run out of), checkout and its preview answer 409 `SUBSCRIPTION_PLAN_NOT_AVAILABLE`, read as
  `{ code, planId, country }` (`country` is null when core had no country). Tell the buyer the plan is
  not available for delivery to that country. A customer's plan change in the portal is refused the same
  way (`customerRefusalOf`), when the new plan adds products that are out of stock there.
- **`clientIp` is required** on preview, start and status, and must be an IPv4 or IPv6 literal:
  core throttles 10 checkouts and 60 status reads per visitor a minute through it, and ignores any
  other value, which leaves every visitor in the shop's one per-server bucket. An IPv4-mapped
  address (`::ffff:203.0.113.7`, what a dual-stack Node server reports) is sent as plain IPv4.
  From `X-Forwarded-For`, pass the one entry your proxy appended, not the list.
- **A start date is strictly after today** in core's time zone (`Europe/Zurich` unless core sets
  `app.time-zone`), at least the lead time out, at most 365 days out, and a scheduled day of the
  pattern; "start now" is no start date. `validFirstDeliveryDates(entry, schedule, todayIn())`
  lists exactly those dates — pass `todayIn()`, not your server's UTC date.
- **Dynamic carts:** `EXTERNAL_PRODUCT` lines without `productId` (a delivery line is one of these, with `delivery: true`) and catalog lines (`productId`, kind `PRODUCT_LINKED`); core rounds every line's
  `unitPrice × quantity` half-up to cents, sums, and refuses a `unitAmount` that differs (400
  `SUBSCRIPTION_DYNAMIC_AMOUNT_MISMATCH`). Send `Number(dynamicUnitAmount(lines))` — it sums the
  same way, exactly, where float sums drift.
- **`configuration`** is a JSON object (yours, opaque to core, at most 8192 characters once
  serialized); `configurationText` is the plain text everyone else reads (at most 500).
- A 409 `CONCURRENT_UPDATE_CONFLICT` (two requests raced for a lock in core) is retried once after
  250 ms by `startSubscriptionCheckout`; it is safe because the reference makes the call
  idempotent.
- **The return page polls.** Status reads are limited to 60 a minute per visitor: read every ~3 s
  for at most 2 minutes, then tell the buyer you are still confirming and offer a reload.
- **A start date reads as paid.** A start-date subscription reports `stripeStatus` `"trialing"`
  until its second charge: Stripe's trial only defers that charge, the first cycle is paid at
  checkout. Only a start-date checkout opened before core 1.9.7 reports `SUCCEEDED` for a saved card
  with no money moved; its return page should say "set up", not "paid".

**Discounts (core ≥ v1.9.30).** A subscription is charged per period, so a discount has a duration
and three figures matter. Send `discountCode` in the request (and `customerSession` in the call
options, for the customer's own discount); the preview answers:

- `amount` is the **first charge** — what the buyer pays now, and the `expectedAmount` to send; `firstAmount` is the same number under the name that pairs with `regularAmount`.
- `regularAmount` is what **each period** costs before any discount, VAT included.
- `discountedAmount` is what a period costs **while the discount lasts** (`null` without one), for
  `discountDuration` — `ONCE`, `REPEATING` (for `discountDurationMonths` calendar months, not periods: on a weekly subscription 3 months is about 13
  deliveries, so never word it as "your first 3 deliveries") or `FOREVER`.
- `discountCode` is the code core applied; `discountCodeRefusal` is why it was not (the preview
  still prices, the checkout refuses with 409 `DISCOUNT_CODE_REFUSED`, same reasons as the
  table under Checkout, `reason` `null` when this SDK does not know it).

Show the first charge and the regular price side by side ("CHF 8.00 today, then CHF 10.00 a
week"); never derive one from the other. A dynamic cart may carry catalog lines (`productId`, kind
`PRODUCT_LINKED`; send the product's catalog price as `unitPrice`, core checks it and refuses any other with `SHOP_PRODUCT_PRICE_OUT_OF_RANGE`; an open price is the buyer's choice) and `delivery: true` lines (no
`productId`). New refusals read by `subscriptionCheckoutRefusalOf`: 404 `SHOP_PRODUCT_NOT_FOUND`, 400
`SHOP_PRODUCT_NOT_PRICED` (`productId`, `currency`), 400 `SHOP_PRODUCT_PRICE_OUT_OF_RANGE`
(`productId`, `currency`), 400 `ORDER_DELIVERY_LINE_WITH_PRODUCT`, 400
`SUBSCRIPTION_DYNAMIC_PRICE_MODE_MISMATCH` (a product priced in the other price mode than the cart's
`dynamic.priceMode`).

Each call checks the request locally first — the generated schema plus a subset of core's own term
rules (one of `planId` / `dynamic`, a schedule shaped for its kind, the cart total, an ISO start
date), not all of them; core's 400 stays the last word — and rejects with a `ZodError` before anything is sent.

**Words for the buyer.** `describeSchedule(schedule, 'de')` → "Jede Woche am Dienstag und Freitag",
`describeBilling('WEEK', 2, 'fr')` → "toutes les 2 semaines"; German, French, Italian and English,
anything else in English. A `MONTHLY_WEEKDAY` rhythm (`weekOfMonth` 1–4, or -1 for the last, and
one `weekday`; needs core 1.9.7) reads "Every first Tuesday of the month", "Jeden ersten Dienstag im
Monat"; it bills like `MONTHLY`, once a month, and each paid month buys one delivery. `firstDeliveryDate(entry, schedule, todayIn())` is the first delivery of
a subscription started now — the `firstDeliveryAt` core will answer.

## Customer portal

Customers manage their subscriptions on the shop's own account pages, signed in by a link core
mails them: no password, no account to create. The shop's server keeps the session in a cookie and
calls core for the customer. Needs a core release with the customer session and the portal.

### Sign-in routes

`signInRoutes` is the whole email-link sign-in as five route handlers (since 0.16.0). A Next satellite
creates them once and exports each from its route file:

```typescript
// lib/sign-in.ts — server only: it holds the client, and with it the WEBSITE key
import 'server-only';
import { createAdibilisClient, signInRoutes } from '@adbls/sdk/server';

export const signIn = signInRoutes({
    client: () => createAdibilisClient({ baseUrl: process.env.ADIBILIS_BASE_URL!, apiKey: process.env.ADIBILIS_API_KEY! }),
    shopName: 'Oh! Blumen',     // names the site in the mail
    language: 'de',             // the mail's language when the form sends none core knows
});

// app/api/account/login/route.ts
export const POST = signIn.login;
// app/account/callback/route.ts — the address core mails
export const GET = signIn.callback;
// app/api/account/session/route.ts
export const POST = signIn.session;
// app/api/account/logout/route.ts
export const POST = signIn.logout;
// app/api/account/expired/route.ts
export const GET = signIn.expired;
```

The handlers are plain functions, so they work unbound. The options:

| Option | Default | Meaning |
|---|---|---|
| `client` | (required) | the site's API client, created when a handler runs |
| `shopName` | core's organization name | names the site in the mail, at most 80 characters |
| `purpose` | the shop sign-in | `'RESOURCES'` for a resources site (see "Resources") |
| `language` | none | the site's language (`de`, `de-CH`); the mail is in the first of the form's `language`, this, and the browser's first `Accept-Language` entry that is German, French, Italian or English, else in the customer's own |
| `paths` | see below | where the pages and routes live; any subset |
| `acceptsReturnPath` | every well-formed path | narrows the return paths the site accepts; it receives path and query (`/resource/12?x=1`) |
| `enabled` | `() => true` | `false` answers every handler with 404 and an empty body |
| `log` | `console.error` | receives every message the handlers write; none carries an address or a token |

`paths` defaults: `login` `/account/login`, `continue` `/account/continue`, `callback` `/account/callback`,
`session` `/api/account/session` (also the handoff cookie's `Path`), `signedIn` `/account`, `signedOut`
`/account/logout`.

| Handler | Does |
|---|---|
| `login` (POST) | form `email`, `next`, `language`: asks core for a link to `<public origin><callback>?next=…` and redirects to `login?sent=1`, or to `login?error=…` |
| `callback` (GET) | parks a well-formed `token` in the `adbl_login` cookie and redirects to `continue`; calls nothing in core, answers `Referrer-Policy: no-referrer` |
| `session` (POST) | spends the parked token, sets `__Host-adbl_customer` and `__Host-adbl_customer_email` (same expiry), deletes the handoff cookie and redirects to `next`, else `signedIn` |
| `logout` (POST) | ends the session in core (a failure is logged and ignored), expires both cookies, redirects to `signedOut` |
| `expired` (GET) | expires both cookies and redirects to `login?error=CUSTOMER_SESSION_INVALID`; calls nothing in core |

**The pages the site renders.**

- **Login** (`paths.login`): a form that POSTs to the `login` route with `email`, and optionally a hidden
  `next` (the page's own `next` search parameter, passed on) and a hidden `language`. `sent=1` means
  "check your inbox", whatever the address: core answers the same for every one.
- **Continue** (`paths.continue`): a form that POSTs to `paths.session` with the hidden `next`, sent as
  soon as the page loads or on a click. On `error` it shows the notice and the button to try again: the
  parked token survives an outage, so the retry spends the same link.
- **Signed out** (`paths.signedOut`), and a logout button on the account pages: a form that POSTs to the
  `logout` route.
- **An account page** whose call core answers 401 `CUSTOMER_SESSION_INVALID` redirects to the `expired`
  route (with `?next=` to come back): a server component cannot clear cookies, and a page that sent the
  visitor back to the account would loop on the dead cookie.

The pages read `error` with the browser-safe `signInNoticeOf(searchParams.error)` (from `@adbls/sdk`),
which answers one of the `SIGN_IN_NOTICES` or `null`:

| Notice | From | Show |
|---|---|---|
| `EMAIL_INVALID` | login | the address is not valid |
| `TOO_MANY_REQUESTS` | login, continue | too many attempts: wait a minute |
| `CUSTOMER_LOGIN_TOKEN_INVALID` | login (after the link or the continue page) | the link was used or has expired, with the form for a new one |
| `CUSTOMER_SESSION_INVALID` | login (after `expired`) | the session ended: sign in again |
| `SIGN_IN_UNAVAILABLE` | login, continue | sign-in is unavailable right now (the cause is in the log) |

**"Signed in as".** `customerEmailFromCookies(await cookies())` answers the signed-in address from
`__Host-adbl_customer_email`, or `null` without a well-formed session cookie. Show it on every account
page: a customer lured into someone else's account by that person's own link then sees whose account it
is. It is for display only and never authenticates anything.

**What the routes hold to.** A return path (`next`) is kept only when it is a path on this site of at
most 512 printable ASCII characters, starting with a single `/` and without `\`, and then only when
`acceptsReturnPath` accepts it; anything else (`//evil.example`, `https://…`, `/ü`) is dropped without an
error. Every answer is a 303 to a site-relative path with `Cache-Control: private, no-store`: inside the
container the request origin is the listen address. A body that is not a form reads as an empty form. The
visitor's address for core is `clientIpOf(request.headers)`: the last `X-Forwarded-For` entry, else
`X-Real-IP`, when it is an IP literal, else `127.0.0.1`. The callback URL core mails is built with
`publicOrigin(request.headers, requestOrigin)`: `X-Forwarded-Host` (else `Host`) with
`X-Forwarded-Proto`, falling back to the request's own scheme; a host that is not a host name (with an optional
port) or a scheme other than `http`/`https` gives the request's own origin. **If core answers
`SHOP_ORIGIN_NOT_ALLOWED` in production, check that the ingress forwards `X-Forwarded-Proto` before
core's settings**; the log line then says which origin to add (`add https://shop.example to core's
SHOP_ALLOWED_ORIGINS`). A 401 from the exchange without a session code is a wrong WEBSITE key, not a
dead link: it answers `SIGN_IN_UNAVAILABLE` and logs "check the WEBSITE key". The `logout` and `expired`
routes expire the cookies only when `Sec-Fetch-Site` is absent, `same-origin` or `none`, so another site
cannot sign a visitor out.

**The building blocks.** A site that is not on Next, or needs its own flow, builds the same thing from
`requestLoginLink`, `exchangeLoginToken`, `expiredCustomerSessionCookie`, `expiredSignInCookies` and
`CUSTOMER_EMAIL_COOKIE`; the rules below are the ones the routes follow.

```typescript
// server side — route handlers and server components only
import {
    requestLoginLink, exchangeLoginToken, customerFromCookies, customerRefusalOf, expiredSignInCookies, clientIpOf,
} from '@adbls/sdk/server';
// browser-safe — the pickers and forms of the account pages
import { dynamicUnitAmount, resumeDateRange, scheduleChangeOf, plansForChange, configurationObjectOf, todayIn } from '@adbls/sdk';
// todayIn() counts in Europe/Zurich; when core sets `app.time-zone`, pass that zone: todayIn('Europe/London')

const visitor = { clientIp: clientIpOf(request.headers) }; // the visitor's IP literal, as for the checkout

// 1. The sign-in form's POST. Answer "check your inbox" whatever the address: core answers 202 for every one.
await requestLoginLink(core, {
    email,
    returnUrl: 'https://shop.example/account/callback', // core appends ?token=…
    language: 'de-CH',                                   // the mail in German, French, Italian or English
    shopName: 'Oh! Blumen',
}, visitor);

// 2. GET /account/callback?token=… changes nothing in core: it parks the token in a short httpOnly cookie
//    and redirects to /account/continue, which POSTs as soon as it loads (no button to click).
// 3. That POST (the token comes from the parked cookie, which the POST then deletes):
try {
    const { cookie } = await exchangeLoginToken(core, token, visitor);
    response.cookies.set(cookie.name, cookie.value, cookie.options); // or the header `Set-Cookie: ${cookie.header}`
    // then 303 to /account
} catch (error) {
    if (customerRefusalOf(error)?.code !== 'CUSTOMER_LOGIN_TOKEN_INVALID') throw error;
    // "This link was used or has expired", with the form for a new one
}

// 4. Every account page and handler (a raw `Cookie` header string works too; with duplicates the last one wins, like Next's store)
const customer = customerFromCookies(core, await cookies(), visitor);
if (!customer) return; // no session cookie: redirect to the sign-in page
const { content } = await customer.listSubscriptions();
const subscription = await customer.getSubscription(id);
// 401 CUSTOMER_SESSION_INVALID on any call: clear the cookie and sign in again.
// A server component cannot clear cookies: redirect to a route handler that sets expiredSignInCookies() (the `expired`
// route) and redirects to the sign-in page, or the next request loops on the same dead cookie.

// 5. A change answers the subscription as it is now: render that, do not read it again
const delivery = subscription.upcomingDeliveries.find((d) => d.skippable);  // the skip button only where skippable
if (delivery) await customer.skipDelivery(id, delivery.id);
const { earliest, latest } = resumeDateRange(todayIn());                     // the pause date picker's bounds
await customer.pause(id, { resumesAt: earliest });
if (scheduleChangeOf(subscription, schedule).allowed) await customer.changeSchedule(id, schedule);
await customer.changeConfiguration(id, { configuration, configurationText, unitAmount: Number(dynamicUnitAmount(lines)) });
await customer.changeDeliveryPerson(id, deliveryPerson);
await customer.cancel(id, { atPeriodEnd: true });                            // reactivate(id) takes it back until then

// 6. Logout: end the session in core, and clear the cookies whatever happens
try {
    await customer.logout();
} finally {
    for (const cleared of expiredSignInCookies()) response.cookies.set(cleared.name, cleared.value, cleared.options);
}
```

**A customer's own discount.** `CustomerSubscription` and `CustomerSubscriptionDetail` carry
`discount` (`CustomerSubscriptionDiscount | null`): `name`, `percent` or `amountOff` with `currency`,
`duration` (`ONCE`, `REPEATING`, `FOREVER`), `months`, `active` and `endsAt`. Show it next to the
price; `active` is false once it has run its course. The figures are core's — never recompute them.

**The link works once, and is spent by a POST from the page, never by the GET of the link.** The
first exchange opens a session; any later one — a reload, a second click, the link opened again
after a logout — answers 401 `CUSTOMER_LOGIN_TOKEN_INVALID`. Mail scanners (Outlook Safe Links and
others) open every link in a mail before the customer does: a callback that exchanged the token while
answering the GET would spend every link on the scanner. The page the link leads to may sign in
without a click, by POSTing as soon as it loads; a scanner that runs the page's script then uses the
link up, and the customer finds it spent and asks for a new one. A "Sign in" button that POSTs costs
one click, and scanners do not click it. Two shapes are allowed, and only these:

- `GET /account/callback?token=…` renders a page that POSTs the token, as soon as it loads or on a
  click (shape 1; its POST handler must be same-origin only, see below); or
- (shape 2) the flow of the sign-in routes: the GET callback route does **not** call core. It stores the token in a
  short `httpOnly` cookie, `adbl_login` (900 s, `Secure`, `SameSite=Strict`, `Path=/api/account/session`),
  and answers 303 to `/account/continue` with `Referrer-Policy: no-referrer` and `Cache-Control: no-store`,
  so the token leaves the address bar and the browser history at once. The continue page POSTs to
  `/api/account/session`, as soon as it loads or on a click; that handler reads the token from the
  cookie, calls `exchangeLoginToken`, deletes the cookie, sets `__Host-adbl_customer` and the page
  goes on to the account.
  `Strict` works because the cookie is needed only on that same-site form POST; the cross-site
  navigation from the mail client does not need it. The handoff cookie keeps its name: it is not
  `__Host-`, because its `Path` is not `/`.

**Shape 1's POST must accept only same-origin requests.** The POST carries the token in its body, so
anyone can build a page that submits *their own* valid token to your handler from the victim's
browser; the victim is then signed in as the attacker (login CSRF) and may enter their card or
address into the attacker's account. Refuse the request unless `Origin` equals your shop's origin
or `Sec-Fetch-Site` is `same-origin` (either is enough: under the `no-referrer` policy below a form
POST sends `Origin: null`, and `Sec-Fetch-Site` then carries the proof):

```typescript
const SHOP_ORIGIN = 'https://shop.example';
export async function POST(request: Request) {
    const sameOrigin = request.headers.get('origin') === SHOP_ORIGIN || request.headers.get('sec-fetch-site') === 'same-origin';
    if (!sameOrigin) return new Response('Forbidden', { status: 403 });
    // …then exchangeLoginToken(core, token, visitor)
}
```

Shape 2 is immune to a forged cross-site POST: the token is not in the request body at all but in the
parked cookie, which the browser does not send with a cross-site POST, so such a POST finds no token.
Keep that cookie's `SameSite` at `Strict` (`Lax` also works). A lure to the callback link itself is not
stopped by either shape: a victim who opens the attacker's own link is signed in to the attacker's
account. Show the signed-in address on every account page, so a customer notices before entering a
card or an address.

Either way the exchange is a POST from the page, never a call to core while answering the GET, and the
GET answers `Referrer-Policy: no-referrer` and `Cache-Control: no-store`. Redirecting before the POST
is fine: a redirect does not spend the link, a call to core does. A link works once, for 15 minutes;
a newer link replaces the unused older ones. On `CUSTOMER_LOGIN_TOKEN_INVALID` show the form for a
new link.

**The session stays on the server.** `exchangeLoginToken` hands the session over only as `cookie`:
`__Host-adbl_customer`, `HttpOnly`, `Secure`, `SameSite=Lax`, `Path=/`, no `Domain` (your `/api/account/*` handlers
need it too), expiring with the session 30 days after sign-in — use does not extend it. Set it and
redirect. Never put the cookie's value, a `CustomerSignIn` or a `CustomerClient` into a page's
props, a JSON answer or a server action's return value. The `CustomerClient` keeps the token in a
private field, so it serialises to `{}`. The `__Host-` prefix requires `Secure`,
`Path=/` and no `Domain`, or the browser drops the cookie silently; the SDK's header meets all three.
Because of the prefix the shop must be served over HTTPS; most browsers treat `http://localhost` as
secure, but Safari may drop `Secure` cookies there; if the cookie is dropped, develop over https. A shop on a sibling subdomain cannot set or overwrite this cookie,
which is the reason for the prefix. Nobody is signed in under the old name `adbl_customer`: the SDK is
not released yet.

**Changing the card.** `beginPaymentMethodUpdate(id)` → hand `clientSecret` and `publishableKey` to
the browser → Payment Element → `stripe.confirmSetup({ elements, redirect: 'if_required', confirmParams: { return_url } })`
→ post `setupIntent.id` (after a redirect: the `setup_intent` query parameter) to your server →
`confirmPaymentMethod(id, setupIntentId)`. The new card is saved in every case; `retry` says what
became of an overdue charge, and there are five outcomes:

| `retry` | Meaning | Show |
|---|---|---|
| `NOT_NEEDED` | nothing was overdue | "card updated" |
| `PAID` | every overdue invoice came back paid; the status turns `ACTIVE` with core's webhook | "card updated, payment received"; read the subscription again in a moment |
| `PROCESSING` | Stripe took the charge but an invoice is still open (a bank debit in flight) | "payment is being processed"; read the subscription again later |
| `DECLINED` | the new card was refused for the overdue invoice | the failure, and `hostedInvoiceUrl` (when present) to pay or authenticate on Stripe's page |
| `UNCONFIRMED` | another Stripe error: the outcome is unknown | neither success nor failure; `hostedInvoiceUrl` (when present) to check or pay, and read the subscription again |

`hostedInvoiceUrl` is present only when Stripe has an invoice page: it is always `null` for
`NOT_NEEDED`, `PAID` and `PROCESSING`, and can be `null` for `DECLINED` and `UNCONFIRMED`. Render the link only when it is set.

`PAYMENT_PROVIDER_ERROR` from `confirmPaymentMethod` (400) does not guarantee the card is unchanged:
Stripe may have applied part of the change before it failed. Read the subscription again and show
the `paymentMethod` it reports, not an assumption.

Open the SetupIntent when the customer clicks "Change card", not on page load.

**Invoices.** Each `listTransactions()` row carries core's own sales invoice for the charge:
`invoiceId` and `invoiceNumber`, both `null` while core has none for the row — then show no
download. (Rows no longer carry Stripe's `hostedInvoiceUrl` / `invoicePdfUrl`; needs the core
release with `GET /api/customer/invoice/{id}/pdf`.) The PDF has no public URL: a route of the shop
fetches it with `customer.invoicePdf(invoiceId)` and streams it on. The account page links to that
route (`<a href={`/api/account/invoice/${row.invoiceId}`}>`, plus `download` to save instead of
open):

```typescript
// app/api/account/invoice/[id]/route.ts
import { cookies } from 'next/headers';
import { clientIpOf, customerFromCookies, customerRefusalOf, expiredCustomerSessionCookie } from '@adbls/sdk/server';

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
    const id = Number((await params).id);
    const customer = customerFromCookies(core, await cookies(), { clientIp: clientIpOf(request.headers) });
    if (!customer) return Response.redirect(new URL('/account/login', request.url), 303);
    if (!Number.isSafeInteger(id) || id < 1) return new Response(null, { status: 404 });
    try {
        const pdf = await customer.invoicePdf(id);
        return new Response(pdf.body, { headers: pdf.headers }); // inline, <invoiceNumber>.pdf, no-store
    } catch (error) {
        switch (customerRefusalOf(error)?.code) {
            case 'INVOICE_NOT_FOUND':
                return new Response(null, { status: 404 });
            case 'TOO_MANY_REQUESTS':
                return new Response(null, { status: 429 });
            case 'CUSTOMER_SESSION_INVALID':
                return new Response(null, {
                    status: 303,
                    headers: { Location: '/account/login', 'Set-Cookie': expiredCustomerSessionCookie().header },
                });
            default:
                throw error;
        }
    }
}
```

`invoicePdf` resolves with `body` (the PDF as core streams it; it can be read once), `contentType`
(`application/pdf`), `filename` (`<invoiceNumber>.pdf`) and `headers` for the browser: core's
`Content-Disposition` (inline), `Cache-Control: private, no-store`, `Content-Security-Policy:
default-src 'none'` and `X-Content-Type-Options: nosniff`. Never cache the PDF or hand it out on a
URL without the session. Core answers 404 `INVOICE_NOT_FOUND` for every invoice that is not in the
signed-in customer's own transactions — another customer's, an unknown id — and 429 beyond 10 PDFs
per visitor a minute (its own budget). An answer that is not a PDF rejects with an `Error`, so the
route never passes anything else on under the shop's origin.

**What core holds you to:**

- **`clientIp` on every call.** `requestLoginLink`, `exchangeLoginToken` and `customerFromCookies`
  all take the visitor's address, with the checkout's rule: an IPv4 or IPv6 literal, IPv4-mapped
  addresses sent as IPv4. Core throttles per visitor with it; a missing or malformed one rejects
  locally before anything is sent.
- **Budgets.** Per visitor a minute: 60 reads, 10 changes, 10 invoice PDFs, 5 card calls, 5 sign-in links, 30
  sign-ins and logouts together; 10 SetupIntents per customer an hour; 5 sign-in mails per address
  an hour (further requests still answer 202, nothing is sent). Every change answers the
  subscription as it is now — render that instead of reading it again.
- **No retries.** The SDK retries no portal call, not even a 429 or a timeout: a change may have
  reached core, so repeating it is the shop's decision, made with a fresh read.
- **The 401 rule.** Only a 401 naming `CUSTOMER_SESSION_INVALID` means "sign in again": clear the
  cookie and redirect. A 401 without that code is a wrong WEBSITE key, which no sign-in fixes — do
  not log the customer out for it.
- **The list shows `startDate`.** `listSubscriptions` rows carry `startDate` for a start-date
  subscription (`null` otherwise), so a not-yet-started subscription can show when it begins instead
  of an empty delivery column. The order across pages is stable (ties break by id), so paging does
  not repeat or skip a row; `listTransactions` refuses `sortBy` and a descending direction.
- **Check before you send.** `scheduleChangeOf(subscription, schedule)` answers what core will: a
  rhythm outside `scheduleDefinition` → `SUBSCRIPTION_SCHEDULE_NOT_ALLOWED`; on a dynamic
  subscription another billing interval (weekly ↔ monthly, every week ↔ every 2 weeks) →
  `SUBSCRIPTION_BILLING_INTERVAL_CHANGE`; otherwise the new `periodAmount` (more weekdays cost
  more). `plansForChange(entries, subscription)` lists the plans a plan change can go to.
  `resumeDateRange(todayIn())` bounds the pause date picker (`todayIn()` defaults to `Europe/Zurich`;
  pass core's zone when the instance sets `app.time-zone`). Show the skip button only where
  `delivery.skippable`.
- **`customerRefusalOf(error)`** reads every refusal; `null` means rethrow.
  `SUBSCRIPTION_ACTION_NOT_ALLOWED` carries `reason`: `CANCELLING` (cancelled at period end — offer
  `reactivate`), `PAST_DUE` (offer the card change), `NOT_PAUSED`, `NOT_CANCELLING`, `CANCELLED`,
  `INCOMPLETE`, `DYNAMIC` (no plan to change). `CONCURRENT_UPDATE_CONFLICT` means Stripe has the
  change and core is still writing it: read the subscription again in a moment, never repeat the
  change.
- **One property per call:** `changePlan`, `changeSchedule`, `changeConfiguration`,
  `changeDeliveryPerson`. `updateSubscription(id, { planId, schedule, configuration, deliveryPerson })`
  sends them one after another in that order, after checking every part, and when core refuses one
  rejects with a `SubscriptionUpdateError`: `applied` lists what is already in effect, `detail` is
  the subscription after it, `customerRefusalOf` reads its cause. `failed` names the part that
  stopped, and `outcome` says what is known about it: `'refused'` when core answered 400, 404 or 409,
  except `CONCURRENT_UPDATE_CONFLICT` and `PAYMENT_PROVIDER_ERROR` (the part is not in effect),
  `'unknown'` for everything else — those two (Stripe may have applied the change), any 5xx or
  proxy answer (a 504), a network error or timeout. On
  `'unknown'` the part may be in effect: read the subscription again before reporting it as failed.
- **Configuration:** `configurationObjectOf(subscription.configuration)` gives back the object your
  checkout sent. A change sends the object again with its `configurationText`; on a dynamic
  subscription also the new `unitAmount` (`Number(dynamicUnitAmount(lines))`), which core prorates
  at the same billing interval. Core cannot know your prices and charges what your server sends:
  build `lines` on the server from your own price list and the stored configuration, never from a
  price, fee or amount the browser posted.
- **Ids are core's.** Another customer's subscription, delivery or invoice answers 404, exactly like a
  missing one; responses never carry a contact id.

Every call checks its input locally first — the generated schema, positive ids, a well-formed
schedule, a JSON-object configuration, ISO dates, the SetupIntent's `seti_…` id (never its client
secret), the visitor's address — and rejects with a `ZodError` before anything is sent.

## Order cancellation

A buyer cancels a one-time order in two ways: by the link in the confirmation mail, or signed in to
the customer portal. Core refunds the payment in full either way. Needs core v1.9.32 or later.

**The link flow.** Pass `cancellationUrl` in `startCheckout` (an absolute URL on an allowed shop
origin, e.g. `https://kaemo.ch/stornieren`). Core mails the buyer `<cancellationUrl>?token=…`. The
page calls `getOrderCancellation(core, token, { clientIp })`, shows the booking, and on confirm calls
`cancelOrderByToken(core, token, { clientIp })`. Both are server-only and return a `CustomerOrder`.

The link stays valid after use: the token is a stateless signature over the order id, it never expires
and is the same in every mail for that order. A re-opened link answers 200 with
`orderStatus: 'CANCELLED'` and the refund, and `cancelOrderByToken` then answers 409
`ORDER_ALREADY_CANCELLED`. So the page checks `orderStatus === 'CANCELLED'` first and shows the
cancelled order with its refund; only an uncancelled order shows the booking and the cancel button.

```typescript
import { headers } from 'next/headers';
import { getOrderCancellation, cancelOrderByToken, orderCancellationRefusalOf, clientIpOf } from '@adbls/sdk/server';

const visitor = { clientIp: clientIpOf(await headers()) };
try {
    const order = await getOrderCancellation(core, token, visitor);   // GET: changes nothing, safe to load on page view
    if (order.orderStatus === 'CANCELLED') {
        // a re-opened link: show the cancelled order and order.refund.status, no button
    } else {
        // show order.lines, and the button only while the shop's own deadline has not passed
        const cancelled = await cancelOrderByToken(core, token, visitor); // on the buyer's confirm, never on page load
        // cancelled.refund.status says what to tell the buyer, see below
    }
} catch (error) {
    const refusal = orderCancellationRefusalOf(error); // null for anything else: rethrow
}
```

A blank or over-long token (core takes at most 200 characters) throws a `ZodError` and sends nothing.

**The deadline is the shop's.** Core never refuses a cancellation because it is too late: it does not
know your classes' rules. The shop computes the deadline from the lines' `externalRef` (the reference
your cart put on each line) and shows the cancel button only before it. Core still refuses an order
that is past cancelling for its own reasons (`ORDER_NOT_CANCELLABLE`).

**What to show for `refund.status`.** Every cancelled order carries `refund`: `{ status, amount, currency, refundedAt }`.

| `refund.status` | what to tell the buyer |
|---|---|
| `NONE` | cancelled; nothing was charged, so nothing is refunded |
| `PENDING` | cancelled; the refund is under way, usually a few days until it reaches the card |
| `SUCCEEDED` | cancelled and refunded on `refundedAt` |
| `FAILED` | cancelled; the studio settles the refund with the buyer. This is a 200 answer, not an error: do not show a failure page |

`NONE` is also what a live, uncancelled order answers, so this table applies once the order is
cancelled (`orderStatus === 'CANCELLED'`).

`cancellationCause` says who cancelled (`CancellationCause`), `cancelledAt` when.

**Refusals.** `orderCancellationRefusalOf(error)` reads them; `null` means rethrow.

| `code` | status | what to do |
|---|---|---|
| `ORDER_CANCELLATION_TOKEN_INVALID` | 401 | the token is malformed or forged, the studio rotated the link secret, or the order no longer exists (a used link is not a 401, see above): say the link is not valid; the buyer can ask the studio |
| `ORDER_ALREADY_CANCELLED` | 409 | show the order as cancelled (read it again for the refund) |
| `ORDER_NOT_CANCELLABLE` | 409 | past the point where a customer can cancel; `status` is the order's status, `null` for one this SDK does not know. Show "please contact the studio" |
| `ORDER_NOT_REFUNDABLE` | 409 | paid in a way core cannot refund; nothing changed. Ask the studio |
| `SHOP_MODULE_DISABLED` | 404 | core's shop module is off; the page is closed |
| `TOO_MANY_REQUESTS` | 429 | this visitor used up 5 cancels or 60 reads a minute; wait, do not loop |

**Signed in.** On the account pages, `customerFromCookies(...)` gives a client with `listOrders({ page, pageSize })`,
`getOrder(id)` and `cancelOrder(id)`. They answer `CustomerOrder`s (a page of them for the list);
`customerRefusalOf` reads the order codes next to the portal's own: 404 `ORDER_NOT_FOUND` (another
customer's order answers the same), and on 409 `ORDER_ALREADY_CANCELLED`, `ORDER_NOT_CANCELLABLE`
(with `status`) and `ORDER_NOT_REFUNDABLE`. The shop's deadline applies here too: hide the button after
it. `CustomerTransaction.orderId` links a payment row to its order; `refundStatus` and `refundedAt`
mark a refunded payment.

**Stripe events.** Core learns a refund's outcome from Stripe. Register `charge.refunded` and
`charge.refund.updated` on core's webhook endpoint, or a `PENDING` refund never turns `SUCCEEDED`
or `FAILED`.

## Shop catalog

A satellite shop sells what core lists for it. An admin enables satellites once (Settings →
Payments → "Enable satellites") and then ticks "List on satellite" per product, giving it a price
in each currency the shop sells in.

```typescript
import { createAdibilisClient, fetchShopProducts, fetchShopProduct, fetchPickupSites } from '@adbls/sdk/server';
import { priceIn, shopImageUrl, vatNoteOf } from '@adbls/sdk';

const products = await fetchShopProducts(core);          // every listed product, by title
const one = await fetchShopProduct(core, 12);            // 404 unless listed

const chf = priceIn(one.prices, 'CHF')?.amount;         // prices carry upper-case ISO codes
const src = shopImageUrl(process.env.ADIBILIS_BASE_URL!, one.mainImagePath!);

const vat = vatNoteOf(one);                              // 'included' | 'excluded' | null
const note = vat === 'included' ? t('incl. VAT') : vat === 'excluded' ? t('excl. VAT, added at checkout') : null;
```

- **403 while satellites are off**, on both calls — a satellite pointed at a misconfigured install
  fails loudly instead of rendering an empty shop. An unlisted or archived product is a **404**,
  indistinguishable from one that never existed.
- **Images need no key.** `mainImagePath` and `images[].path` are paths on core
  (`/api/public/media/product/{id}/{file}`), served anonymously and cached for a day. Compose the
  absolute URL on the server and hand it to the page as a prop.
- **VAT is the product's, the wording is yours.** `vatNoteOf(product)` answers `'included'`
  (`priceMode: 'BRUTTO'`, the price already contains VAT), `'excluded'` (`'NETTO'`, VAT is added on
  top at checkout) or `null` for a VAT-exempt product, which shows no note. The SDK bundles no
  language, so the site words it. Each price also carries a `vatRate` (percent, `null` when
  exempt): since core v1.9.20 the rate of the product's VAT class (standard, reduced, accommodation)
  in the organization's own country. Don't show it by default: checkout charges by the buyer's
  country — a delivery abroad is 0 % — and an account with Stripe automatic tax charges that
  country's rate. A core before product VAT sends neither field and reads as VAT-included, which is
  what its prices always were.
- **Pickup sites (core ≥ v1.9.20).** `fetchPickupSites(core)` lists the storage sites a buyer can
  collect from, each with its address; an install without the inventory module answers `[]`. A
  `PICKUP` order or subscription checkout names the chosen one as `pickupSiteId`, and core prices
  it by that site's country instead of the delivery address.
- **Prices carry a discount.** Each price may have `discountedAmount` (the price to charge) and
  `discountEndsAt`. `shopPriceView(price, product.openPrice, now?)` (browser-safe, `@adbls/sdk`) turns
  one into what the page shows: `{ amount, discountedAmount, savingPercent, discountEndsAt, openRange }`,
  decimal strings with two places, `savingPercent` a whole number rounded down. A discount is shown
  only while `amount > 0`, `0 <= discountedAmount < amount` and its end has not passed at `now` — so a
  cached page never advertises an offer that is over. Word it yourself ("was CHF 40.00, now CHF 32.00,
  until 1 Dec").
- **Open prices.** A product with `openPrice: true` lets the buyer name the price: `amount` is the
  minimum ("from CHF 20.00") and the price also carries `maximumAmount` and `step`. `shopPriceView(...)`
  returns them as `openRange` (`{ minimum, maximum, step }`, `null` for an ordinary product);
  `isValidOpenPrice(range, chosen)` says whether a value is inside the range and on the step grid, and
  `openPriceSteps(range)` lists every choice for a dropdown. It lists **every** step, so a wide range with
  a small step is a long list: for many steps use a numeric input and `isValidOpenPrice`. The chosen price
  goes to checkout as the line's `unitPrice` (see Checkout).
- **Discounts on an open price (core ≥ v1.9.31).** A price's `discounts` lists every running automatic discount that reaches
  the product (`{ percent, amountOff, endsAt }`, one of `percent` / `amountOff` set; the customer group's too
  when the call carried the customer session). `discountedAmount` is computed on the minimum, so for the price
  the buyer picked use `openPriceDiscount(price, chosen, now?)` (browser-safe): it returns
  `{ amount, discountedAmount, saving, percent, amountOff, endsAt }` for the winning discount, or `null`. A
  percent saves `chosen × percent / 100` rounded half up, an amount saves at most the chosen price, the larger
  saving wins (the first listed on a tie) and ended discounts are ignored. A bouquet at 100 with 10 % shows
  `90.00`, with CHF 5 off `95.00`, with both `90.00`. Core still prices the charge from the chosen
  `unitPrice`; this is only what to display.

  ```ts
  const view = openPriceDiscount(price, chosen);
  if (view) show(`was ${view.amount}, now ${view.discountedAmount}`);
  ```
- **Prices for a signed-in customer.** `fetchShopProducts(core, { customerSession })` and
  `fetchShopProduct(core, id, { customerSession })` take the portal session from
  `customerSessionFromCookies(await cookies())` (a cookie store or a raw `Cookie` header; `null` without
  a well-formed one, no request made) and answer the prices of the customer's group, with
  `discountedAmount` for that customer. An expired or unknown session is priced as anonymous, not
  refused. **A session-priced response is per customer and must never be cached for other visitors:**
  the SDK sends it `cache: 'no-store'`; do not put it in a shared cache (a CDN, `unstable_cache`, ISR). Keep
  the anonymous catalog cacheable and read the session-priced one only on a request that carries the
  cookie. `discountedAmount` never reflects a subscription, a generated code or free delivery: those
  appear in the checkout preview only. Checkout and subscription checkout take the same
  `{ customerSession }`.
- **Checkout prices come from here too.** Put `productId` on an order line and core prices it from
  the product's price in the order's `currency`, ignoring `unitPrice` (except for an open-price product, see Checkout), and recomputes `grandTotal`.
  A product with no price in that currency is refused (`SHOP_PRODUCT_NOT_PRICED`) before any order
  exists. Core routes the invoice to the Stripe account configured for that currency, so the
  `publishableKey` in the checkout response can differ between a CHF and a EUR order.
- **`available` is `false` only for a product core sells "stop at 0" that no distributor can
  ship**; show "Out of stock" instead of "Add to cart". It is not a per-country answer: checkout
  can still refuse a line for the buyer's own country (`productUnavailableOf`, see Checkout). A core
  older than `v1.9.7` sends no field, so read `available !== false`.
- **`taxAmount` is always the order's VAT total** — Stripe's figure on an account with automatic
  tax, core's own otherwise. It used to be `0` unless automatic tax was on.
- **Cancelled class dates.** `fetchCancelledBookings(core, { clientIp })` (server-only) lists the
  class dates the studio cancelled: `{ productId, startAt }`, `startAt` an instant. Hide those dates
  from the booking picker, and `checkoutRefusalOf` still answers 409 `BOOKING_DATE_CANCELLED` for one
  that slips through. Compare with `isBookingCancelled(productId, startAt, cancelled)` (browser-safe),
  never as strings: the same instant can be written two ways. Like any shop read it can answer 404
  `SHOP_MODULE_DISABLED` and 429; there is no refusal reader for it. Core answers
  `Cache-Control: private, max-age=60`: cache the list 60 seconds and merge it with the shop's own
  list of cancelled dates.

## Newsletter

A sign-up form on the shop posts to your server, which signs the visitor up:

```typescript
import { subscribeNewsletter } from '@adbls/sdk/server';

await subscribeNewsletter(core, {
    firstname, lastname, email,            // required
    consent: true,                         // must be `true` — collect consent before submitting
    website,                               // the honeypot input's raw value — see below
    salutation: 'MR',                      // optional: MR, MS or DIVERSE — see "The Anrede"
    language: 'de',                        // optional: de, fr, it or en — lower-case, exactly these
}, { clientIp });                          // the visitor's IP, from your request
```

| Answer | Meaning |
|---|---|
| `202` | **accepted** — the call resolves with nothing, for a new address, a known one and one already subscribed alike |
| `400` | validation — core's violations are in `err.body`: `NEWSLETTER_CONSENT_REQUIRED` for `consent: false`, `NotNull` on `consent` when it is missing, the Bean Validation codes for the other fields (a `language` like `de-CH` or `DE` included). Not retryable |
| `429` | `TOO_MANY_REQUESTS` — beyond 5 sign-ups a minute per visitor (`X-Shop-Client-Ip`), or 120 a minute per shop server |
| `503` | `NEWSLETTER_NOT_STORED`, with `Retry-After: 60` — core could not store the sign-up (e.g. its Newsletter group is missing until core restarts with the shop module on). Ask the visitor to **try again later** |
| `401` / `403` | the WEBSITE key is missing, wrong or not allowed to sign people up |

Every non-2xx is an `AdibilisApiError`; read its `status`.

- **The page always says the same thing.** Core gives the same empty 202 whether the address was
  new, known or already subscribed, so the form never reveals who is on the list.
- **`website` is the honeypot**, exactly as for `submitPropertyEnquiry`: a hidden input a person
  leaves empty. Forward its raw value and never set it yourself. A non-blank `website` skips every
  local check and is sent as-is, so a bot gets core's silent 202 rather than a client-side
  rejection that would reveal the trap.
- **`clientIp` on every call**, as for `requestLoginLink`: core rate-limits per visitor with it. An
  address that is no IPv4 or IPv6 literal (a host name, a forwarded-for list) is a `ZodError` before
  any request.
- **`language` is not a locale.** Core takes `de`, `fr`, `it` or `en` and answers 400 for anything
  else; the SDK does not normalise, so map `de-CH` to `de` yourself.
- A blank first or last name, an `email` that is no address, a `consent` other than `true` or a
  `language` outside those four is a `ZodError` before any request; every other rule is core's.

## Properties

Six server-side calls cover a real-estate satellite end to end: a public listing, a public detail
page, the enquiry form on that page, the valuation calculator's submit, the result page it redirects
to, and the "I want a real valuation" button on that page.

```typescript
import {
    createAdibilisClient,
    fetchPublishedProperties,
    fetchPublishedProperty,
    submitPropertyLead,
    fetchPropertyLead,
    requestPropertyValuation,
    submitPropertyEnquiry,
} from '@adbls/sdk/server';

const core = createAdibilisClient({ baseUrl: process.env.ADIBILIS_BASE_URL!, apiKey: process.env.ADIBILIS_API_KEY! });
```

### 1. The listing

```typescript
const { content, totalElements, totalPages } = await fetchPublishedProperties(core, { page: 0, size: 24 });
```

Core returns only properties carrying a **live `OWN_WEBSITE` listing**, newest first. The ordering
is fixed — `PropertyService.published` forces `DESC` — so there is no sort option to pass.

> The option is `size`, but it goes on the wire as `pageSize`, because that is the field core binds
> (`ch.adibilis.dto.PageRequest`). A hand-rolled `?size=` is silently ignored and every page comes
> back at the default 20. `fetchPublishedProperties` does the mapping for you.

### 2. The detail page

```typescript
const property = await fetchPublishedProperty(core, id); // 404 if it is not published
```

A property that exists but is not published is a **404**, indistinguishable from an id that never
existed. That is deliberate: an unauthenticated site must not be able to enumerate the drafts in
the pipeline.

### 3. Images — no key, no client

Property images are the one part of this flow that does **not** go through the API client. Portal
crawlers fetch listing images by absolute URL and cannot present a key, so core serves them
unauthenticated:

```typescript
const src = `${process.env.NEXT_PUBLIC_ADIBILIS_BASE_URL}/api/public/media/property/${property.id}/${property.avatarFilePath}`;
// every image: property.media.map((m) => `.../api/public/media/property/${property.id}/${m.filePath}`)
```

The lookup is property-scoped through the media table — nothing from the request reaches the
filesystem, only image-like media kinds answer, and only properties with a live `OWN_WEBSITE`
listing. Cached publicly for one day, so an unpublish can still be served from a shared cache for
up to that long. **Use the public base URL here**, not the server-side one: this is an `<img src>`
rendered in a browser.

### 4. The calculator submits a lead

```typescript
const { publicToken, number } = await submitPropertyLead(core, {
    contact: { firstname, lastname, email, phone },
    estate: { street, city, zip },      // country and canton optional
    category: 'HOUSE',
    type: 'VILLA',                      // the type owns the pair — a mismatched category is overridden
    inputs: { livingArea: 180, numberOfRooms: 5.5 },   // whatever your calculator asked
    result: { low: 1_200_000, high: 1_500_000 },       // whatever your calculator computed
    calculatedAmount: 1_350_000,
    source: 'valuation-calculator',     // required: which calculator produced this
});
```

Core creates the seller contact, a `LEAD`-status property and the lead row. `inputs` and `result`
are free-form JSON: the SDK does not model your calculator, it just carries it.

The payload is checked against the generated zod schema before it leaves the process, so a missing
`contact`, an incomplete `estate` or a forgotten `source` is a `ZodError` here rather than a 400
round-trip. The schema is a **subset** of core's rules — it accepts whitespace-only strings and any
string as an email, both of which core still rejects.

**Keep `publicToken`.** It is the only handle on the lead and core never returns it again; redirect
to your result page with it (`/valuation/${publicToken}`).

### 5. The result page, and the ask

```typescript
const lead = await fetchPropertyLead(core, token);   // 404 on an unknown token
await requestPropertyValuation(core, token);         // empty response; core mails the team
```

Reading the lead is a write on core's side: the first read stamps `viewedAt`, which is how the ERP
knows the seller opened the result. `requestPropertyValuation` stamps `valuationRequestedAt` and is
**idempotent** — a second call on an already-requested lead succeeds and sends no second mail, so a
double-clicked button needs no guard.

### 6. A visitor asks about a property

```typescript
await submitPropertyEnquiry(core, property.id, {
    firstname, lastname, phone, message,   // all optional
    email,                                 // required
    salutation: 'MS',                      // optional: MR, MS or DIVERSE — see "The Anrede"
    language: 'de',                        // optional: de, fr, it or en
    consent: true,                         // must be `true` — collect consent before submitting
    newsletter: false,                     // optional
    website,                               // the honeypot input's raw value — see below
    clientIp,                              // required: the visitor's IP, from your request
    source: 'example-detail',              // required: lower-case letters, digits and hyphens
});
```

| Answer | Meaning |
|---|---|
| `202` | **accepted**, not necessarily stored — the call resolves with nothing |
| `400` | validation — `ENQUIRY_CONSENT_REQUIRED` for consent, the Bean Validation codes for the other fields; the violations are in `err.body.violations`, an array of `{ field, code, … }`. Not retryable |
| `404` | the property is not published (or never existed) |
| `403` | the `properties` module is off |
| `503` | **not stored** — the site may retry |

Every non-2xx is an `AdibilisApiError`; read its `status`. Of those, only the 503 is worth a retry.

A **network failure** (DNS, connection reset, timeout) is not an `AdibilisApiError`: the platform
fetch's plain `TypeError` propagates as is, and the enquiry may or may not have reached core. A retry
is safe — no second contact and no second interest are created. It is not absorbed, though: a retry
within 24 h of the same e-mail + property adds a new ingest record and appends a duplicate note to
the existing interest.

**A 202 means accepted, not stored.** Core answers the same empty 202 when it drops an enquiry as a
honeypot hit, or under its per-IP or per-property+email rate limit. The site cannot tell these apart,
by design — a bot learns nothing from the answer.

**`website` is the honeypot.** Render it as a hidden input (off-screen, `tabindex="-1"`,
`autocomplete="off"`) that a person never sees and so leaves **empty**; bots fill every field. Forward
the input's raw value verbatim and never set it yourself — in particular, never put the site's own
URL there: any non-blank `website` makes core drop the enquiry as a bot, with a 202.

**`clientIp` is required — forward the visitor's IP.** Core rate-limits enquiries per IP, and every
request arrives from the satellite's server, so an enquiry without one falls back to a single bucket
shared by every visitor of the site. Once that bucket is full, core drops every further enquiry
**silently with a 202**: the form keeps "working" and nothing is stored. The SDK therefore rejects a
missing or blank `clientIp` with a `ZodError` before any request.

As with the lead, the payload is checked against the generated zod schema first, so a missing
`email`, a `consent` other than `true` or a missing `source` is a `ZodError` before any request. The
schema's patterns are unanchored, though: a `source` like `Example-Detail` passes here and core still
answers 400.

### The module row, not the key

All six are gated on `hasRole('WEBSITE')` **and** on the `properties` module row. A tenant that has
not enabled the module answers **403, not 404** — on every one of them, including the public-looking
listing. A satellite pointed at a misconfigured install therefore fails loudly instead of rendering
an empty page. `properties` ships **disabled** on a fresh install; an operator enables the
`adbl_module` row directly in the database (there is no API for it), and the change can take up to
two cache TTLs to land.

## Google reviews

Once the tenant connects its Google Business Profile in core, one call gives the site its reviews.
Fetch them in a server component:

```tsx
import { fetchGoogleReviews } from '@adbls/sdk/server';

export async function Reviews() {
    const { rating, reviewCount, reviews } = await fetchGoogleReviews(core);
    if (reviews.length === 0) return null;

    return (
        <section>
            <p>{rating?.toFixed(1)} ★ · {reviewCount} reviews on Google</p>
            {reviews.map((review) => (
                <figure key={review.createTime + review.authorName}>
                    {review.authorPhotoUrl && <img src={review.authorPhotoUrl} alt="" />}
                    <figcaption>{review.authorName} · {'★'.repeat(review.starRating)}</figcaption>
                    {review.comment && <blockquote>{review.comment}</blockquote>}
                    {review.replyComment && <p>Reply from the owner: {review.replyComment}</p>}
                </figure>
            ))}
            <a href={process.env.GOOGLE_PROFILE_URL}>See all reviews on Google</a>
        </section>
    );
}
```

- **Hide the section when `reviews` is empty.** A tenant that has not connected Google, or has not
  chosen a location, gets `{ reviewCount: 0, reviews: [] }` and no `rating` — a 200, never an
  error. Render nothing rather than "0 reviews".
- **Core never calls Google on your request.** It answers from what its daily refresh stored, so the
  call is fast and cannot hit Google's quota. A failed refresh keeps the last stored reviews, so the
  list can be a few days old but does not disappear.
- **Every stored review comes back, newest first** — not a sample. Slice it yourself if the page
  shows only a few.
- `comment` is `''` for a rating left without text; `replyComment` is the owner's answer, if any.

Google sets the rules for showing these reviews:

- **Say they come from Google**: the Google logo or the word "Google" next to the reviews.
- **Show each reviewer as delivered**: `authorName`, and `authorPhotoUrl` where there is one. Do not
  shorten, translate or replace either.
- **Never edit the review text.** No trimming, no rewording, no picking sentences; show `comment` as
  it is, or not at all.
- **Link to Google.** The response carries no per-review link, so link the business's Google
  profile (keep its URL in your own config).
- **Do not keep your own copy.** Fetch per render (or with the short revalidation your framework
  uses for the page) and never write the reviews into a database, a file or a long-lived cache — core
  already holds the copy Google's terms allow.

## Resources

A resources site is a satellite that publishes core's library: articles, downloads and videos, filed
under topics, some open to everyone and some only to the members of the contact groups that unlock them.
Five server-side calls read it, and two browser-safe helpers turn the paths core writes into the
URLs a browser loads. Needs core ≥ v1.9.32 with the `resources` module enabled.

```typescript
// server side — route handlers and server components only
import { cookies, headers } from 'next/headers';
import {
    listResources, getResource, listResourceTopics, listResourceProducts,
    customerSessionFromCookies, resourceRefusalOf, expiredCustomerSessionCookie, clientIpOf,
} from '@adbls/sdk/server';
// browser-safe
import { resourceAssetUrl, rewriteResourceBody } from '@adbls/sdk';

const visitor = {
    clientIp: clientIpOf(await headers()),                            // the visitor's IP literal, as for the checkout
    customerSession: customerSessionFromCookies(await cookies()),     // null for an anonymous visitor
};

// The library page: every published card, locked ones included. The filters are all optional; blank ones are left out.
const cards = await listResources(core, { search: 'tax', topicId: 3, format: 'PDF', language: 'DE' }, visitor);
const topics = await listResourceTopics(core, visitor);              // the topic filter, with a count each
const products = await listResourceProducts(core, visitor);          // the product filter

// A resource's page. A locked one is a 200, not an error: render the teaser and the sign-in.
const resource = await getResource(core, id, visitor).catch((error) => {
    if (resourceRefusalOf(error)?.code !== 'CUSTOMER_SESSION_INVALID') throw error;
    return null;
});
if (!resource) return redirectToSignIn(expiredCustomerSessionCookie());  // a dead session: clear the cookie, sign in again
if (!resource.card.unlocked) return renderTeaser(resource.card);
```

**The list is unpaged and open.** It answers every published resource as a card, ordered by topic and
then by the resource's own order; narrow it with the filters (`search`, `topicId`, `format`, `language`,
`productId`, `categoryId`, `groupSlug`) instead of paging it; `language` is `DE`, `FR`, `IT` or `EN`, not a
locale. A card the visitor's groups do not unlock
has `unlocked === false`: show its teaser and the sign-in. The detail of a locked resource carries no
`body` and no `files`. An unpublished resource is a 404, exactly like an unknown id.

**Files.** A public file and every cover is served by core itself at
`/api/public/media/resource/{id}/{file}`: no key, cached publicly for a day, and it may be framed, so an
inline PDF viewer works. A member-only file goes through the satellite: a route handler streams it with
`resourceFile`, so the key and the visitor's session never reach the browser.

```typescript
// app/api/resource/[id]/file/[mediaId]/route.ts
import { AdibilisApiError, resourceFile, customerSessionFromCookies, clientIpOf } from '@adbls/sdk/server';

export async function GET(request: Request, { params }: { params: Promise<{ id: string; mediaId: string }> }) {
    const { id, mediaId } = await params;
    try {
        const file = await resourceFile(core, Number(id), Number(mediaId), {
            clientIp: clientIpOf(request.headers),
            customerSession: customerSessionFromCookies(await cookies()),
            range: request.headers.get('range'),      // a seekable video and a resumed download need it
        });
        return new Response(file.body, { status: file.status, headers: file.headers });  // 200 or 206
    } catch (error) {
        if (error instanceof AdibilisApiError) return new Response(null, { status: error.status });
        throw error;
    }
}
```

`resourceFile` resolves with `status` (200, or 206 for a range), `body` (a stream, read once) and
`headers`: only what core sent of `Content-Type`, `Content-Length`, `Content-Range`, `Accept-Ranges` and
`Content-Disposition`, plus `Cache-Control: private, no-store`, `X-Content-Type-Options: nosniff` and
`Content-Security-Policy: default-src 'none'`. Nothing else of core's answer (`Set-Cookie`,
`X-Frame-Options`) reaches your origin. Any other answer rejects with an `AdibilisApiError`; a locked
file is 403 `RESOURCE_LOCKED`, and a range past the end of the file is a 416 whose `body` is `null` (the
file itself is never read). Never cache the answer, and never serve a public file through this route.

**Covers, files and article images.** A resource carries core's paths, never URLs: `card.coverPath`,
each file's `path`, and the `<img src>` of an article `body`. `resourceAssetUrl` turns a path into what a
browser should load: a protected file path into your proxy route, a public media path into core's
absolute URL. `rewriteResourceBody` does the same for every `<img src>` of a body and drops an image
whose source is not one of core's two shapes. Any other path answers `null`. Both are browser-safe, so
compose the URLs on the server and hand the result to the page as a prop: the core base URL is then
never inlined into a bundle.

```typescript
const assets = { coreBaseUrl: process.env.ADIBILIS_BASE_URL!, proxyBase: '/api/resource' };
const cover = resource.card.coverPath ? resourceAssetUrl(resource.card.coverPath, assets) : null; // string | null
const downloads = resource.files.map((file) => ({ file, href: resourceAssetUrl(file.path, assets) }));
const html = rewriteResourceBody(resource.body ?? '', assets);        // render as the article
```

**Signing in is the portal's "Sign-in routes" with a purpose.** Any contact can receive a resources link:
no purchase is needed. Staff and unknown addresses get the same 202 and no mail. The site's origin must
be one of core's `RESOURCES_ALLOWED_ORIGINS`. Everything else is the portal's flow unchanged, so read
"Sign-in routes" above for the five route files, the pages and the notices: the `session` route sets the
same `__Host-adbl_customer` cookie, `customerSessionFromCookies` reads it, and the `logout` route signs
out. A locked resource's page sends the visitor to the login page with `?next=/resource/12`, and
`acceptsReturnPath` decides which paths may come back.

```typescript
export const signIn = signInRoutes({
    client: () => core,
    shopName: 'Example resources',
    purpose: 'RESOURCES',
    language: 'de',
    acceptsReturnPath: (path) => /^\/resource\/\d+$/.test(path),
});
```

The routes' log names a refused origin (`add https://resources.example to core's RESOURCES_ALLOWED_ORIGINS`).
`requestLoginLink` refuses a `RESOURCES` link with 400 `RESOURCES_ORIGIN_NOT_ALLOWED` (the origin is not
in core's list: a setup error) and 404 `RESOURCES_MODULE_DISABLED`. Once the shop and resources modules
are both off, `exchangeLoginToken` and `logout` answer 404 `CUSTOMER_SIGN_IN_DISABLED`; clear the cookie
anyway. `customerRefusalOf` reads all three.

**What core holds you to:**

- **`clientIp` on every call**, with the checkout's rule: an IPv4 or IPv6 literal. Core throttles per
  visitor with it; a missing or malformed one rejects locally before anything is sent.
- **Budgets.** Per visitor a minute: 60 reads (list, detail, topics, products) and 300 files; per shop
  server 1200 and 3000. A 429 means this visitor used it up: wait, do not loop.
- **Every read is live.** The calls are sent with `cache: 'no-store'`: unpublishing a resource or
  changing a group invalidates nothing on the satellite, so do not cache what they return.
- **A session only when there is one.** An empty or `null` `customerSession` is an anonymous call; an
  expired or unknown one is refused with 401 `CUSTOMER_SESSION_INVALID`: clear the cookie and sign in
  again. A 401 without that code is a wrong WEBSITE key, which no sign-in fixes.
- **`resourceRefusalOf(error)`** reads every refusal; `null` means rethrow.

| Code | Status | Meaning |
|---|---|---|
| `CUSTOMER_SESSION_INVALID` | 401 | the session expired or was revoked: clear the cookie, sign in again |
| `RESOURCES_MODULE_DISABLED` | 404 | the resources module is off: the site is closed |
| `RESOURCE_NOT_FOUND` | 404 | unknown or unpublished resource (core does not tell which) |
| `MEDIA_NOT_FOUND` | 404 | the resource has no such file |
| `RESOURCE_LOCKED` | 403 | the file of a resource the visitor's groups do not unlock (file call only): show the sign-in |
| `TOO_MANY_REQUESTS` | 429 | this visitor's budget is used up |

**Core must be set up for the site:** the `resources` module enabled, the site's origin listed in
`RESOURCES_ALLOWED_ORIGINS` (Settings → Resources → Website in core) and a WEBSITE API key in the
satellite's environment. Ids and filters are checked locally first and reject with a `ZodError` before
anything is sent.

## Health

One call, for the satellite's own health endpoint:

```typescript
import { checkCore } from '@adbls/sdk/server';

const { ok, status, latencyMs } = await checkCore(core);   // { ok: true, status: 200, latencyMs: 12 }
```

`GET /api/website/ping` behind it needs no module and returns a constant, so it works on a shop
tenant and a properties tenant alike. It is the only call in this SDK that **never throws** — it is
meant to run inside a health route, where an exception turns a legible "degraded" answer into a 500
that says nothing about which side broke. Read `status` for the diagnosis:

| `status` | Meaning |
|---|---|
| `200` | core answers and this WEBSITE key is valid |
| `401` | the key was rotated or revoked — core is fine |
| `0` | nothing answered: DNS, TLS, a refused socket, or the timeout |

The budget is 3 s by default (`{ timeoutMs }` to change it), because a health check that hangs is a
health check that reports nothing. It is deliberately **uncached**: whoever polls decides how often
core should be bothered, and a cache hidden in a library would make two callers with different needs
fight over one interval. The satellite template caches it for 30 s in its own route.

Why a satellite needs this at all: it renders its own pages, so a broken link to core is invisible
from outside — the site keeps answering 200 with empty listings or a dead checkout, and an uptime
probe sees nothing wrong.

## Starter template

`template/` is a runnable Next.js satellite showing both boundaries in place: a route handler on
`@adbls/sdk/server`, a client component on the root entry, no `stripe` and no `nodemailer`. Copy
it to start a new shop. See `template/README.md`.

## Install

```bash
pnpm add @adbls/sdk zod        # add react too if you use @adbls/sdk/checkout
```

Public on npmjs.org, no token needed. Released versions carry the `latest` dist-tag; there are no
prerelease channels.

## Versioning

The SDK carries **its own semver** — it is not pinned to the core release tag. A tag `v1.2.3` on
`main` publishes `1.2.3`; nothing else publishes.

## Relationship to `@adbls/api-types`

`@adbls/api-types` is generated from the CORE backend and versioned 1:1 with the core
release tag: `@adbls/api-types@1.4.7` is exactly the API of core `v1.4.7`. It is public too,
and you can depend on it directly when you build beyond what the SDK wraps.

The dependency range here is the statement of *which core releases this SDK speaks to*: **0.15.0 requires
`@adbls/api-types` ^1.9.32 / core v1.9.32 or later** (the resources module and the sign-in `purpose`: an older core
answers the resource endpoints with 404, does not know the `'RESOURCES'` purpose, and refuses the portal's sign-in
calls with `SHOP_MODULE_DISABLED` instead of `CUSTOMER_SIGN_IN_DISABLED`). **0.16.0 keeps that floor**: the sign-in
routes call only the endpoints 0.15.0 already did.

Earlier floors: `^1.9.32` (0.14.0) was the first core release with order cancellation, refunds and cancelled class dates; an older core
answers those endpoints with 404 and does not mail `cancellationUrl`. `^1.9.31` (0.13.0) was the first with a shop price's `discounts`,
read by `openPriceDiscount`; an older core leaves
the field absent, so `openPriceDiscount` returns `null`; in your own test fixtures the types now require
`ShopProductPriceResponse.discounts`. `^1.9.30` was the first core release with discounts (codes, customer-group prices, open prices,
delivery lines, the portal's `discount`; an older core ignores the new request fields, `discountCode` and `delivery`, so a code is never applied, and
leaves the new response fields absent, `CheckoutPreview.discountTotal` included: absent, not `0`). In your own test fixtures the types now require
`ShopProductResponse.openPrice`, `CheckoutPreview.discountTotal`, the subscription checkout amounts' `firstAmount`, `regularAmount`,
`discountedAmount`, `discountDuration`, `discountDurationMonths`, `discountCode` and `discountCodeRefusal`, and
`CustomerSubscription.discount` and `CustomerSubscriptionDetail.discount`.

Before that, `^1.9.20` was
the first core release with pickup sites (`GET /api/shop/pickup-site`, `pickupSiteId` on an order and a
subscription checkout) and VAT by country and class (a shop price's `vatRate` is the rate of the
product's VAT class in the organization's country). `^1.9.14` was the first refusing a subscription
plan whose first delivery is out of stock (409 `SUBSCRIPTION_PLAN_NOT_AVAILABLE`), `^1.9.9` the first the first serving `GET /api/review/published`
(`fetchGoogleReviews`; an older core answers it with 404), `^1.9.7` the first with stock availability
(`ShopProductResponse.available` and the 409 `SHOP_PRODUCT_NOT_AVAILABLE` checkout refusal).
`submitPropertyEnquiry` **needs core ≥ v1.5.1**: an older core lacks
`POST /api/property/{id}/enquiry`, and the resulting 404/405 reads like "property not published".
Core `v1.4.6` was the first release carrying
the shop catalog, per-currency Stripe accounts and catalog-priced checkout lines; `1.4.7` is the
first version published under this name. A range,
not a pin, so a new core release reaches SDK users without an SDK release; the SDK only needs a
release when it wants something new from core.

The subscription and customer-portal functions need a core release with the subscription checkout,
the customer session and the portal; an older core answers their endpoints with 404.

`subscribeNewsletter` needs a core release that serves `POST /api/shop/newsletter`; an older core
refuses it (typically with a 404).

`invoicePdf` and the transactions' `invoiceId` / `invoiceNumber` need the core release after 1.9.7
that serves `GET /api/customer/invoice/{id}/pdf`. An older core answers that path with 404 and still
sends Stripe's `hostedInvoiceUrl` / `invoicePdfUrl` on the rows instead, which this SDK no longer
types: upgrade core and the SDK together.

## Two credentials, never confuse them

- **Publishing** — no token at all: GitHub Actions publishes via npm trusted publishing (OIDC).
  Installing needs no token either.
- **WEBSITE API key** — runtime, lives in a satellite's environment, authenticates the API client
  against CORE.

Different lifetimes, different blast radii. Neither belongs in a commit.

## What the WEBSITE key can reach

Measured against a running CORE instance with a provisioned key, not inferred from the source. Full
write-up: `2026-08-24-website-blast-radius-inventory.md`.

**Granted outright** — the endpoints gated on `hasRole('WEBSITE')`:

| Endpoint | Note |
|---|---|
| `GET /api/website/ping` | the health check (`checkCore`); no module gate, constant answer |
| `GET /api/shop/holidays` | 404 while the `shop` module is disabled |
| `GET /api/shop/product` | the products listed on satellites; 403 while satellites are disabled |
| `GET /api/shop/product/{id}` | 404 unless that product is listed |
| `POST /api/payment/checkout` | creates the order and its Stripe invoice (`startCheckout`), or with `preview: true` only prices it (`previewCheckout`) |
| `GET /api/payment/order` | the order's payment state (`getOrderStatus`) |
| `GET /api/shop/subscription-plan` | the dynamic "Subscribe this order" entry and the listed plans (`fetchSubscriptionPlans`); 403 while satellites are disabled, 404 while the `shop` module is |
| `GET /api/shop/subscription-plan/{id}` | 404 unless that plan is listed |
| `POST /api/subscription/checkout` | opens a subscription in core and at Stripe (`startSubscriptionCheckout`), or with `preview: true` only prices it (`previewSubscriptionCheckout`); 429 beyond 10 per visitor (`X-Shop-Client-Ip`) or 300 per shop server a minute |
| `GET /api/subscription/status` | the subscription behind a shop reference (`getSubscriptionStatus`); 429 beyond 60 per visitor or 1200 per shop server a minute |
| `POST /api/shop/newsletter` | signs a visitor up for the newsletter (`subscribeNewsletter`); always 202 for an accepted sign-up (new, known or already subscribed address, honeypot hit); 400 = validation; 429 beyond 5 per visitor (`X-Shop-Client-Ip`) or 120 per shop server a minute; 503 `NEWSLETTER_NOT_STORED` (`Retry-After: 60`) = not stored, try again later |
| `POST /api/customer/login-link` | mails a customer a one-time sign-in link, valid 15 minutes (`requestLoginLink`); always 202; with `purpose: 'RESOURCES'` any contact gets the resources link, 400 `RESOURCES_ORIGIN_NOT_ALLOWED` for a `returnUrl` outside `RESOURCES_ALLOWED_ORIGINS` and 404 `RESOURCES_MODULE_DISABLED`; 429 beyond 5 per visitor or 120 per shop server a minute; 5 mails per address an hour |
| `POST /api/customer/session` | exchanges the link's token for a 30-day session, once per link (`exchangeLoginToken`); 401 `CUSTOMER_LOGIN_TOKEN_INVALID` for a used, expired or unknown link; 404 `CUSTOMER_SIGN_IN_DISABLED` once the shop and resources modules are both off; 429 beyond 30 per visitor or 600 per shop server a minute, shared with logout |
| `DELETE /api/customer/session` | ends the session (`logout`); 200 even for a session that is gone; can also answer 404 `CUSTOMER_SIGN_IN_DISABLED` and 429 (shared with sign-ins) — clear the cookie anyway |
| `GET /api/customer/subscription[/{id}]`, `GET /api/customer/transaction` | the signed-in customer's subscriptions and payments (`X-Customer-Session`); 429 beyond 60 per visitor or 1200 per shop server a minute |
| `GET /api/customer/invoice/{id}/pdf` | the PDF of an invoice in the signed-in customer's transactions (`invoicePdf`); 404 `INVOICE_NOT_FOUND` for any other; 429 beyond 10 per visitor or 300 per shop server a minute |
| `PATCH /api/customer/subscription/{id}/plan\|schedule\|configuration\|delivery-person`, `POST …/{id}/cancel\|reactivate\|pause\|resume`, `POST …/{id}/delivery/{deliveryId}/skip` | the customer's changes; 429 beyond 10 per visitor or 300 per shop server a minute |
| `POST\|PATCH /api/customer/subscription/{id}/payment-method` | the card change (`beginPaymentMethodUpdate`, `confirmPaymentMethod`); 429 beyond 5 per visitor or 120 per shop server a minute, and beyond 10 SetupIntents per customer an hour |
| `GET /api/payment/order/cancellation?token=` | the order behind a cancellation mail's token (`getOrderCancellation`); 401 `ORDER_CANCELLATION_TOKEN_INVALID` for a malformed or forged token, a rotated link secret or an order that no longer exists (never for a used or old link); can also answer 404 `SHOP_MODULE_DISABLED`; 429 beyond 60 per visitor or 1200 per shop server a minute |
| `POST /api/payment/order/cancel` | cancels that order and refunds it (`cancelOrderByToken`); 409 `ORDER_ALREADY_CANCELLED`, `ORDER_NOT_CANCELLABLE`, `ORDER_NOT_REFUNDABLE`; 401 `ORDER_CANCELLATION_TOKEN_INVALID`; 404 `SHOP_MODULE_DISABLED`; 429 beyond 5 per visitor or 120 per shop server a minute |
| `GET /api/customer/order` | one page of the signed-in customer's one-time orders (`listOrders`, `X-Customer-Session`); 429 beyond 60 per visitor or 1200 per shop server a minute |
| `GET /api/customer/order/{id}` | one order of the signed-in customer's (`getOrder`); 404 `ORDER_NOT_FOUND` for another customer's |
| `POST /api/customer/order/{id}/cancel` | the customer cancels and refunds an order (`cancelOrder`); the same 409 refusals as by link |
| `GET /api/shop/booking/cancelled` | the class dates the studio cancelled (`fetchCancelledBookings`); 404 while the `shop` module is disabled; `Cache-Control: private, max-age=60` |
| `POST /api/sales/order/ingest/stripe` | the legacy ingest path, deprecated in favour of checkout |
| `GET /api/property/published` | one page of the properties with a live `OWN_WEBSITE` listing |
| `GET /api/property/published/{id}` | 404 unless that property is published |
| `POST /api/property/lead` | creates a seller contact, a `LEAD` property and the lead |
| `GET /api/property/lead/{token}` | the lead behind a public token; the first read stamps `viewedAt` |
| `POST /api/property/lead/{token}/valuation-request` | stamps the request and mails the team; idempotent |
| `POST /api/property/{id}/enquiry` | accepts a visitor's enquiry about a published property (`submitPropertyEnquiry`); 202 = accepted (honeypot hits and rate-limit drops too), 400 = validation (`body.violations`), 503 = not stored |
| `GET /api/review/published` | the tenant's stored Google reviews (`fetchGoogleReviews`); no module gate; an empty list, not an error, while Google is not connected |
| `GET /api/website/resource` | every published resource as a card, locked ones with `unlocked: false` (`listResources`); unpaged; 404 `RESOURCES_MODULE_DISABLED`; 401 `CUSTOMER_SESSION_INVALID` for a dead session (`X-Customer-Session`); 429 beyond 60 per visitor (`X-Shop-Client-Ip`) or 1200 per shop server a minute |
| `GET /api/website/resource/{id}` | one resource with its body and files (`getResource`); a locked one answers 200 without body or files; 404 `RESOURCE_NOT_FOUND` for an unknown or unpublished one; same budget as the list |
| `GET /api/website/resource/{id}/file/{mediaId}` | a file of a resource the session unlocks, `Range` supported (`resourceFile`); 403 `RESOURCE_LOCKED`, 404 `MEDIA_NOT_FOUND`, 416 for a range past the end; 429 beyond 300 per visitor or 3000 per shop server a minute |
| `GET /api/website/resource-topic` | the topics holding a published resource, with their counts (`listResourceTopics`); 404 `RESOURCES_MODULE_DISABLED`; 60 per visitor a minute |
| `GET /api/website/resource-product` | the products a published resource refers to (`listResourceProducts`); 404 `RESOURCES_MODULE_DISABLED`; 60 per visitor a minute |

The six property endpoints answer **403** while the `properties` module row is disabled — unlike
`/api/shop/holidays`, which 404s while `shop` is disabled. Not a typo in either place: holidays
predates the module-row convention.

`GET /api/public/media/property/{id}/{file}`, `GET /api/public/media/product/{id}/{file}` and
`GET /api/public/media/resource/{id}/{file}` are **`permitAll`** — no key at all — because portal crawlers and
shop visitors' browsers fetch these images (and, for resources, the public files and covers) by absolute URL.

(The inventory linked above predates the two payment endpoints; re-run it before a key ships.)

**Reachable incidentally**, because a WEBSITE principal satisfies `isAuthenticated()`:

| Endpoint | What comes back |
|---|---|
| `GET /api/contact/person` | **0 rows** |
| `GET /api/company` | **0 rows** |
| `GET /api/company/select` | **0 rows** |
| `GET /api/contact-group/select` | **0 rows** |
| `GET /api/contact/search` | 0 rows (scoped to the caller) |
| `GET /api/me/access` | its own permissions — empty |
| `GET /api/company/organization` | the install's org identity |
| `GET /api/team/search` | team **names** |

Everything catalog-gated (`@perm.has`) returns **403**: the service user holds no contact-group
roles, so its effective action set is empty. Creates and deletes are denied.

The customer database is therefore closed — the relation data-grant predicate filters every row, and
the service user holds no grants.

### Two things to know before deploying a satellite

1. **A leaked key can rotate itself.** `POST /api/security/api-key` succeeds for a WEBSITE principal
   and *replaces* the existing key. Whoever holds the key can mint a replacement only they know and
   break the live shop in the same call. Deliberate for a service account, questionable for a session
   authenticated by the very key being replaced. Open decision.
2. **The empty blast radius is a seeding convention, not an enforced rule.** `ApiKeyFilter` intersects
   authorities with `API_KEY_ROLES`, which looks protective, but `@perm` never consults authorities —
   it recomputes from the user's contact-group roles in the database. Assigning any group role to
   `website@adibilis.local` would silently widen every key that user holds.

## Dates are strings

`@adbls/api-types` types Java `LocalDate` and `Instant` as `string` (`2026-05-14`,
`2026-07-04T23:27:30.828Z`) — the wire format — since core's zod profile switched to
`dateAsString`. Earlier builds typed them as `Date`, which `JSON.parse` never produces, so the SDK
used to redeclare date-bearing shapes; it imports the generated ones now. Compare ISO dates as
strings (they order lexicographically) or parse them yourself. In the customer portal's responses
`nextBillingAt`, `nextDeliveryAt`, `pausedUntil`, `startDate` and a delivery's `dueDate` are
date-only (`YYYY-MM-DD`, core's time zone): never `new Date('2026-11-03')`, which is UTC midnight
and shows the previous day west of Greenwich. The other timestamps are instants. So are `startAt`
(a cancelled class date), and an order's `orderedAt`, `cancelledAt` and `refundedAt`.
