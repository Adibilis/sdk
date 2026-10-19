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
| `@adbls/sdk/server` | the API client, the checkout, shop catalog, subscription, customer portal and properties calls — **holds the WEBSITE key and customer sessions** | **no — server only** |

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
browser. The order — and its Stripe invoice — only comes into being when the buyer clicks "Pay";
until then a **preview** prices the cart and creates nothing.

```typescript
import { createAdibilisClient, previewCheckout, startCheckout, amountChangedOf, getOrderStatus } from '@adbls/sdk/server';

const core = createAdibilisClient({ baseUrl: process.env.ADIBILIS_BASE_URL!, apiKey: process.env.ADIBILIS_API_KEY! });
const request = {
    order,                                   // OrderIngestRequest; validated with the generated zod schema
    returnUrl: 'https://shop.example/checkout/return?ref=' + order.externalRef,
};

// 1. Whenever the cart, country or an address field that affects tax changes: price it.
//    Nothing is created. amount/taxAmount are major units, vatRate is null for mixed rates.
const preview = await previewCheckout(core, request);
// preview.amount, preview.taxAmount, preview.vatRate, preview.currency (lower-case), preview.publishableKey

// 2. On "Pay": create the order and its invoice, refusing if the total moved since the preview.
try {
    const { clientSecret } = await startCheckout(core, { ...request, expectedAmount: preview.amount });
    // hand clientSecret to the browser: stripe.confirmPayment({ elements, clientSecret, confirmParams: { return_url } })
} catch (error) {
    const newAmount = amountChangedOf(error); // number on 409 CHECKOUT_AMOUNT_CHANGED, otherwise null
    if (newAmount === null) throw error;
    // core already voided the invoice: preview again, tell the buyer the price changed, let them pay again
}

// 3. From your success page's route handler: the truth is core's, not the browser's.
const { orderStatus } = await getOrderStatus(core, order.externalSource, order.externalRef); // 'PAID' once the webhook landed
```

**Elements in deferred mode.** There is no `clientSecret` before "Pay", so mount Elements from the
preview: `loadStripe(preview.publishableKey)` and
`<Elements options={{ mode: 'payment', amount: Math.round(preview.amount * 100), currency: preview.currency }}>`
(`amount` in minor units). On "Pay" call `elements.submit()`, then `startCheckout`, then
`stripe.confirmPayment({ elements, clientSecret, ... })`. The publishable key follows the currency,
so it can differ between a CHF and a EUR cart.

The preview's order fields (`orderId`, `clientSecret`, `invoiceId`, ...) are all `null` and
`preview` is `true`. It is validated and refused like `startCheckout` — same endpoint, so
`returnUrl` is required here too. With automatic tax on, core taxes the order's own address, never
one stored on a known buyer: the delivery person's address when the order has one (goods are
shipped), otherwise the billing person's. Send the preview the same delivery and billing addresses
the real checkout will carry; only the country is required. A Stripe rejection of the address
(e.g. `customer_tax_location_invalid` where a postal code is needed) surfaces as a 400
`PAYMENT_PROVIDER_ERROR`.
`expectedAmount` is optional; without it core does not check the total.

Core, not the shop, holds the Stripe secret key, receives the webhook, marks the order paid and
mails the buyer. The shop keeps only `@stripe/stripe-js` / `@stripe/react-stripe-js`, and
`returnUrl` must sit on the shop URL (or an allowed extra origin) configured in core's payment
settings.

`(externalSource, externalRef)` is the order's identity: mint `externalRef` once per cart state and
reuse it for a retry with another card — core resumes the same order and invoice and **ignores the
new payload**, so a declined card never produces a second charge. A resumed attempt is checked
against `expectedAmount` too. A changed cart or address needs a new reference (the old order stays
`PENDING_PAYMENT`). Sending a pair whose invoice is already paid is refused.

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

## Subscriptions

A subscription is sold through core the way an order is: core owns the plan, the delivery schedule
and the deliveries, Stripe bills each period **in advance**. The shop lists what core lists, lets
the buyer choose a delivery rhythm, previews the first charge and starts the checkout on
"Subscribe". Needs a core release with the subscription checkout.

```typescript
// server side — route handlers
import {
    createAdibilisClient, fetchSubscriptionPlans, previewSubscriptionCheckout, startSubscriptionCheckout,
    getSubscriptionStatus, subscriptionCheckoutRef, subscriptionCheckoutRefusalOf,
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
const visitor = { clientIp: visitorIpOf(request) };                // the buyer's IP literal as your server saw it

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
    // SUBSCRIPTION_START_DATE_INVALID → refusal.earliest; TOO_MANY_REQUESTS → wait, then try again
}

// the return page: core's word, not the browser's. Status reads are limited to 60 a minute per visitor: poll every ~3 s, for at
// most 2 minutes, and stop on a final status.
const { status, firstPaymentStatus } = await getSubscriptionStatus(core, 'flora', externalRef, visitor);
```

**In the browser.** `secretKind` says which Stripe.js call takes the secret — `confirmMethodOf`
(from `@adbls/sdk`) maps it: `PAYMENT` → `stripe.confirmPayment` (the first period is charged now),
`SETUP` → `stripe.confirmSetup` (a start date was chosen; the card is saved and charged on that
date). Before "Subscribe", mount Elements in deferred mode from the preview: without a start date
`{ mode: 'subscription', amount: Math.round(preview.amount * 100), currency: preview.currency.toLowerCase() }`,
with one `{ mode: 'setup', currency: preview.currency.toLowerCase() }`. Core sends the currency
upper-case (`CHF`); Stripe wants it lower-case.

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
  in core: deriving again gives the same reference, so the cart needs a new `cartRef`. Stripe drops
  an unpaid checkout after 23 hours; its reference is then spent (409 `SUBSCRIPTION_CHECKOUT_EXPIRED`)
  and the cart needs a new `cartRef` too. Core also cancels a start-date checkout that Stripe returns
  without anything to confirm, and cancels a row its post-create check finds at another amount than
  `expectedAmount`: the same reference then gets `SUBSCRIPTION_CHECKOUT_EXPIRED`.
  `SUBSCRIPTION_ALREADY_ACTIVE` is the opposite: the reference became a subscription, show success.
- **Refusals a buyer can hit at run time**, all read by `subscriptionCheckoutRefusalOf`: 400
  `SUBSCRIPTION_DYNAMIC_DISABLED` (core offers no dynamic entry), 404 `SHOP_SUBSCRIPTION_PLAN_NOT_FOUND`
  (the plan was unlisted or archived since you read the catalog), 400 `SUBSCRIPTION_START_DATE_NOT_ALLOWED`
  (not one of `validFirstDeliveryDates`) and 429 `TOO_MANY_REQUESTS`. Re-read the catalog for the
  first two; do not retry the last in a loop.
- **`clientIp` is required** on preview, start and status, and must be an IPv4 or IPv6 literal:
  core throttles 10 checkouts and 60 status reads per visitor a minute through it, and ignores any
  other value, which leaves every visitor in the shop's one per-server bucket. An IPv4-mapped
  address (`::ffff:203.0.113.7`, what a dual-stack Node server reports) is sent as plain IPv4.
  From `X-Forwarded-For`, pass the one entry your proxy appended, not the list.
- **A start date is strictly after today** in core's time zone (`Europe/Zurich` unless core sets
  `app.time-zone`), at least the lead time out, at most 365 days out, and a scheduled day of the
  pattern; "start now" is no start date. `validFirstDeliveryDates(entry, schedule, todayIn())`
  lists exactly those dates — pass `todayIn()`, not your server's UTC date.
- **Dynamic carts:** only `EXTERNAL_PRODUCT` lines without `productId`; core rounds every line's
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
- **A trial reads as set up, not paid.** A trialing subscription with a confirmed setup reports
  `firstPaymentStatus` `SUCCEEDED` and `stripeStatus` `"trialing"` while no money has moved yet, so a
  return page should say "set up", not "paid".

Each call checks the request locally first — the generated schema plus a subset of core's own term
rules (one of `planId` / `dynamic`, a schedule shaped for its kind, the cart total, an ISO start
date), not all of them; core's 400 stays the last word — and rejects with a `ZodError` before anything is sent.

**Words for the buyer.** `describeSchedule(schedule, 'de')` → "Jede Woche am Dienstag und Freitag",
`describeBilling('WEEK', 2, 'fr')` → "toutes les 2 semaines"; German, French, Italian and English,
anything else in English. `firstDeliveryDate(entry, schedule, todayIn())` is the first delivery of
a subscription started now — the `firstDeliveryAt` core will answer.

## Customer portal

Customers manage their subscriptions on the shop's own account pages, signed in by a link core
mails them: no password, no account to create. The shop's server keeps the session in a cookie and
calls core for the customer. Needs a core release with the customer session and the portal.

```typescript
// server side — route handlers and server components only
import {
    requestLoginLink, exchangeLoginToken, customerFromCookies, customerRefusalOf, expiredCustomerSessionCookie,
} from '@adbls/sdk/server';
// browser-safe — the pickers and forms of the account pages
import { dynamicUnitAmount, resumeDateRange, scheduleChangeOf, plansForChange, configurationObjectOf, todayIn } from '@adbls/sdk';
// todayIn() counts in Europe/Zurich; when core sets `app.time-zone`, pass that zone: todayIn('Europe/London')

const visitor = { clientIp: visitorIpOf(request) }; // the visitor's IP literal, as for the checkout

// 1. The sign-in form's POST. Answer "check your inbox" whatever the address: core answers 202 for every one.
await requestLoginLink(core, {
    email,
    returnUrl: 'https://shop.example/account/callback', // core appends ?token=…
    language: 'de-CH',                                   // the mail in German, French, Italian or English
    shopName: 'Oh! Blumen',
}, visitor);

// 2. GET /account/callback?token=… changes nothing in core: it parks the token in a short httpOnly cookie
//    and redirects to /account/continue, which renders a "Sign in" button that POSTs.
// 3. That button's POST (the token comes from the parked cookie, which the POST then deletes):
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
// A server component cannot clear cookies: redirect to a route handler that sets expiredCustomerSessionCookie() and
// redirects to the sign-in page, or the next request loops on the same dead cookie.

// 5. A change answers the subscription as it is now: render that, do not read it again
const delivery = subscription.upcomingDeliveries.find((d) => d.skippable);  // the skip button only where skippable
if (delivery) await customer.skipDelivery(id, delivery.id);
const { earliest, latest } = resumeDateRange(todayIn());                     // the pause date picker's bounds
await customer.pause(id, { resumesAt: earliest });
if (scheduleChangeOf(subscription, schedule).allowed) await customer.changeSchedule(id, schedule);
await customer.changeConfiguration(id, { configuration, configurationText, unitAmount: Number(dynamicUnitAmount(lines)) });
await customer.changeDeliveryPerson(id, deliveryPerson);
await customer.cancel(id, { atPeriodEnd: true });                            // reactivate(id) takes it back until then

// 6. Logout: end the session in core, and clear the cookie whatever happens
const cleared = expiredCustomerSessionCookie();
try {
    await customer.logout();
} finally {
    response.cookies.set(cleared.name, cleared.value, cleared.options);
}
```

**The link is spent on a POST behind a real button, never on a GET.** Mail scanners (Outlook Safe
Links and others) open every link in a mail before the customer does, some with JavaScript running.
A callback that exchanged the token while rendering would sign the scanner in, and the customer
would find the link used. Two shapes are allowed, and only these:

- `GET /account/callback?token=…` renders a "Sign in" button that POSTs the token (shape 1; its POST
  handler must be same-origin only, see below); or
- (shape 2) the template's flow: the GET callback route does **not** call core. It stores the token in a short
  `httpOnly` cookie (a few minutes, `Path` limited to the continue page and the exchange handler,
  `SameSite=Lax`, `Secure`) and redirects to a continue page, so the token leaves the address bar
  and the browser history at once. The continue page renders the "Sign in" button; its POST reads
  the token from that cookie, calls `exchangeLoginToken`, deletes the cookie, sets `adbl_customer`
  and redirects.

**Shape 1's POST must accept only same-origin requests.** The POST carries the token in its body, so
anyone can build a page that submits *their own* valid token to your handler from the victim's
browser; the victim is then signed in as the attacker (login CSRF) and may enter their card or
address into the attacker's account. Refuse the request unless `Origin` equals your shop's origin,
or `Sec-Fetch-Site` is `same-origin`:

```typescript
const SHOP_ORIGIN = 'https://shop.example';
export async function POST(request: Request) {
    const origin = request.headers.get('origin');
    const sameOrigin = origin !== null ? origin === SHOP_ORIGIN : request.headers.get('sec-fetch-site') === 'same-origin';
    if (!sameOrigin) return new Response('Forbidden', { status: 403 });
    // …then exchangeLoginToken(core, token, visitor)
}
```

Shape 2 is immune: the token is not in the request body at all but in the parked cookie, which the
browser sends only with same-site requests (`SameSite=Lax` with a POST from another site is not
sent), so a forged cross-site POST finds no token. Keep that cookie's `SameSite` at `Lax` or `Strict`.

Either way the exchange is a POST, the button is a real click (never an auto-submitting form, never
a script), and the GET answers `Referrer-Policy: no-referrer` and `Cache-Control: no-store`.
Redirecting before the button is fine: a redirect does not spend the link, a call to core does. A
link works once, for 15 minutes; a newer link replaces it.

**The session stays on the server.** `exchangeLoginToken` hands the session over only as `cookie`:
`adbl_customer`, `HttpOnly`, `Secure`, `SameSite=Lax`, `Path=/` (your `/api/account/*` handlers
need it too), expiring with the session 30 days after sign-in — use does not extend it. Set it and
redirect. Never put the cookie's value, a `CustomerSignIn` or a `CustomerClient` into a page's
props, a JSON answer or a server action's return value. The `CustomerClient` keeps the token in a
private field, so it serialises to `{}`. Most browsers accept a `Secure` cookie from
`http://localhost`; if yours drops it, develop over https.

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

`hostedInvoiceUrl` is present only when Stripe has an invoice page: it is `null` for `NOT_NEEDED`
and can be `null` for `DECLINED` and `UNCONFIRMED`. Render the link only when it is set.

`PAYMENT_PROVIDER_ERROR` from `confirmPaymentMethod` (400) does not guarantee the card is unchanged:
Stripe may have applied part of the change before it failed. Read the subscription again and show
the `paymentMethod` it reports, not an assumption.

Open the SetupIntent when the customer clicks "Change card", not on page load.

**What core holds you to:**

- **`clientIp` on every call.** `requestLoginLink`, `exchangeLoginToken` and `customerFromCookies`
  all take the visitor's address, with the checkout's rule: an IPv4 or IPv6 literal, IPv4-mapped
  addresses sent as IPv4. Core throttles per visitor with it; a missing or malformed one rejects
  locally before anything is sent.
- **Budgets.** Per visitor a minute: 60 reads, 10 changes, 5 card calls, 5 sign-in links, 30
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
  stopped, and `outcome` says what is known about it: `'refused'` when core answered 400, 404 or 409
  with a code of its own (the part is not in effect), `'unknown'` for everything else —
  `CONCURRENT_UPDATE_CONFLICT`, any 5xx or proxy answer (a 504), a network error or timeout. On
  `'unknown'` the part may be in effect: read the subscription again before reporting it as failed.
- **Configuration:** `configurationObjectOf(subscription.configuration)` gives back the object your
  checkout sent. A change sends the object again with its `configurationText`; on a dynamic
  subscription also the new `unitAmount` (`Number(dynamicUnitAmount(lines))`), which core prorates
  at the same billing interval.
- **Ids are core's.** Another customer's subscription or delivery answers 404, exactly like a
  missing one; responses never carry a contact id.

Every call checks its input locally first — the generated schema, positive ids, a well-formed
schedule, a JSON-object configuration, ISO dates, the SetupIntent's `seti_…` id (never its client
secret), the visitor's address — and rejects with a `ZodError` before anything is sent.

## Shop catalog

A satellite shop sells what core lists for it. An admin enables satellites once (Settings →
Payments → "Enable satellites") and then ticks "List on satellite" per product, giving it a price
in each currency the shop sells in.

```typescript
import { createAdibilisClient, fetchShopProducts, fetchShopProduct } from '@adbls/sdk/server';
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
  exempt), but don't show it by default: an account with Stripe automatic tax charges the rate of
  the buyer's country, which can differ from it. This needs a core release with product VAT; an
  older core sends neither field and reads as VAT-included, which is what its prices always were.
- **Checkout prices come from here too.** Put `productId` on an order line and core prices it from
  the product's price in the order's `currency`, ignoring `unitPrice`, and recomputes `grandTotal`.
  A product with no price in that currency is refused (`SHOP_PRODUCT_NOT_PRICED`) before any order
  exists. Core routes the invoice to the Stripe account configured for that currency, so the
  `publishableKey` in the checkout response can differ between a CHF and a EUR order.
- **`taxAmount` is always the order's VAT total** — Stripe's figure on an account with automatic
  tax, core's own otherwise. It used to be `0` unless automatic tax was on.

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

The dependency range here is the statement of *which core releases this SDK speaks to*: `^1.5.1`.
`submitPropertyEnquiry` **needs core ≥ v1.5.1**: an older core lacks
`POST /api/property/{id}/enquiry`, and the resulting 404/405 reads like "property not published".
Core `v1.4.6` was the first release carrying
the shop catalog, per-currency Stripe accounts and catalog-priced checkout lines; `1.4.7` is the
first version published under this name. A range,
not a pin, so a new core release reaches SDK users without an SDK release; the SDK only needs a
release when it wants something new from core.

The subscription and customer-portal functions need a core release with the subscription checkout,
the customer session and the portal; an older core answers their endpoints with 404. Until
`@adbls/api-types` carries those types, `src/subscription/wire.ts` holds a verbatim copy of core's
generated ones; the release that raises the dependency replaces it with re-exports, and nothing that
imports from the SDK changes.

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
| `POST /api/customer/login-link` | mails a customer a one-time sign-in link (`requestLoginLink`); always 202; 429 beyond 5 per visitor or 120 per shop server a minute; 5 mails per address an hour |
| `POST /api/customer/session` | exchanges the link's token for a 30-day session (`exchangeLoginToken`); 401 `CUSTOMER_LOGIN_TOKEN_INVALID`; 429 beyond 30 per visitor or 600 per shop server a minute, shared with logout |
| `DELETE /api/customer/session` | ends the session (`logout`); 200 even for a session that is gone; can also answer 404 `SHOP_MODULE_DISABLED` and 429 (shared with sign-ins) — clear the cookie anyway |
| `GET /api/customer/subscription[/{id}]`, `GET /api/customer/transaction` | the signed-in customer's subscriptions and payments (`X-Customer-Session`); 429 beyond 60 per visitor or 1200 per shop server a minute |
| `PATCH /api/customer/subscription/{id}/plan\|schedule\|configuration\|delivery-person`, `POST …/{id}/cancel\|reactivate\|pause\|resume`, `POST …/{id}/delivery/{deliveryId}/skip` | the customer's changes; 429 beyond 10 per visitor or 300 per shop server a minute |
| `POST\|PATCH /api/customer/subscription/{id}/payment-method` | the card change (`beginPaymentMethodUpdate`, `confirmPaymentMethod`); 429 beyond 5 per visitor or 120 per shop server a minute, and beyond 10 SetupIntents per customer an hour |
| `POST /api/sales/order/ingest/stripe` | the legacy ingest path, deprecated in favour of checkout |
| `GET /api/property/published` | one page of the properties with a live `OWN_WEBSITE` listing |
| `GET /api/property/published/{id}` | 404 unless that property is published |
| `POST /api/property/lead` | creates a seller contact, a `LEAD` property and the lead |
| `GET /api/property/lead/{token}` | the lead behind a public token; the first read stamps `viewedAt` |
| `POST /api/property/lead/{token}/valuation-request` | stamps the request and mails the team; idempotent |
| `POST /api/property/{id}/enquiry` | accepts a visitor's enquiry about a published property (`submitPropertyEnquiry`); 202 = accepted (honeypot hits and rate-limit drops too), 400 = validation (`body.violations`), 503 = not stored |

The six property endpoints answer **403** while the `properties` module row is disabled — unlike
`/api/shop/holidays`, which 404s while `shop` is disabled. Not a typo in either place: holidays
predates the module-row convention.

`GET /api/public/media/property/{id}/{file}` and `GET /api/public/media/product/{id}/{file}` are
**`permitAll`** — no key at all — because portal crawlers and shop visitors' browsers fetch these
images by absolute URL.

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
and shows the previous day west of Greenwich. The other timestamps are instants.
