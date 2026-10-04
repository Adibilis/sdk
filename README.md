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
| `@adbls/sdk` | forms, order model, holidays, product image/price helpers | **yes** |
| `@adbls/sdk/checkout` | the React checkout context | **yes** |
| `@adbls/sdk/server` | the API client, the checkout, shop catalog and properties calls — **holds the WEBSITE key** | **no — server only** |

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

Two server-side calls, both on `@adbls/sdk/server`, are the whole payment integration:

```typescript
import { createAdibilisClient, startCheckout, getOrderStatus } from '@adbls/sdk/server';

const core = createAdibilisClient({ baseUrl: process.env.ADIBILIS_BASE_URL!, apiKey: process.env.ADIBILIS_API_KEY! });

// 1. From your checkout route handler: create the order, get what Stripe Elements needs.
const { clientSecret, publishableKey, orderNumber } = await startCheckout(core, {
    order,                                   // OrderIngestRequest; startCheckout validates it with the generated zod schema
    returnUrl: 'https://shop.example/checkout/return?ref=' + order.externalRef,
});

// 2. From your success page's route handler: the truth is core's, not the browser's.
const { orderStatus } = await getOrderStatus(core, order.externalSource, order.externalRef); // 'PAID' once the webhook landed
```

Core, not the shop, holds the Stripe secret key, receives the webhook, marks the order paid and
mails the buyer. The shop keeps only `@stripe/stripe-js` to render the payment element with the
`clientSecret`, and `returnUrl` must sit on the shop URL (or an allowed extra origin) configured
in core's payment settings.

`(externalSource, externalRef)` is the order's identity: mint `externalRef` once per cart and reuse
it for a retry — core resumes the same order and invoice and **ignores the new payload**, so a
declined card never produces a second charge, and a changed cart needs a new reference. Sending a
pair whose invoice is already paid is refused.

## Shop catalog

A satellite shop sells what core lists for it. An admin enables satellites once (Settings →
Payments → "Enable satellites") and then ticks "List on satellite" per product, giving it a price
in each currency the shop sells in.

```typescript
import { createAdibilisClient, fetchShopProducts, fetchShopProduct } from '@adbls/sdk/server';
import { priceIn, shopImageUrl } from '@adbls/sdk';

const products = await fetchShopProducts(core);          // every listed product, by title
const one = await fetchShopProduct(core, 12);            // 404 unless listed

const chf = priceIn(one.prices, 'CHF')?.amount;         // prices carry upper-case ISO codes
const src = shopImageUrl(process.env.ADIBILIS_BASE_URL!, one.mainImagePath!);
```

- **403 while satellites are off**, on both calls — a satellite pointed at a misconfigured install
  fails loudly instead of rendering an empty shop. An unlisted or archived product is a **404**,
  indistinguishable from one that never existed.
- **Images need no key.** `mainImagePath` and `images[].path` are paths on core
  (`/api/public/media/product/{id}/{file}`), served anonymously and cached for a day. Compose the
  absolute URL on the server and hand it to the page as a prop.
- **Checkout prices come from here too.** Put `productId` on an order line and core prices it from
  the product's price in the order's `currency`, ignoring `unitPrice`, and recomputes `grandTotal`.
  A product with no price in that currency is refused (`SHOP_PRODUCT_NOT_PRICED`) before any order
  exists. Core routes the invoice to the Stripe account configured for that currency, so the
  `publishableKey` in the checkout response can differ between a CHF and a EUR order.

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
    consent: true,                         // required, a real boolean — the visitor's answer
    newsletter: false,                     // optional
    website,                               // the honeypot input's raw value — see below
    clientIp,                              // required: the visitor's IP, from your request
    source: 'example-detail',                // required: lower-case letters, digits and hyphens
});
```

| Answer | Meaning |
|---|---|
| `202` | **accepted**, not necessarily stored — the call resolves with nothing |
| `404` | the property is not published (or never existed) |
| `403` | the `properties` module is off |
| `503` | **not stored** — the site may retry |

Every non-2xx is an `AdibilisApiError`; read its `status`. Only the 503 is worth a retry.

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
`email`, a non-boolean `consent` or a missing `source` is a `ZodError` before any request. The
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

The dependency range here is the statement of *which core releases this SDK speaks to*: `^1.4.7`.
Core `v1.4.6` was the first release carrying the shop catalog, per-currency Stripe accounts and
catalog-priced checkout lines; `1.4.7` is the first version published under this name. A range,
not a pin, so a new core release reaches SDK users without an SDK release; the SDK only needs a
release when it wants something new from core.

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
| `GET /api/shop/products` | the products listed on satellites; 403 while satellites are disabled |
| `GET /api/shop/products/{id}` | 404 unless that product is listed |
| `POST /api/payment/checkout` | creates the order and its Stripe invoice (`startCheckout`) |
| `GET /api/payment/order` | the order's payment state (`getOrderStatus`) |
| `POST /api/sales/order/ingest/stripe` | the legacy ingest path, deprecated in favour of checkout |
| `GET /api/property/published` | one page of the properties with a live `OWN_WEBSITE` listing |
| `GET /api/property/published/{id}` | 404 unless that property is published |
| `POST /api/property/lead` | creates a seller contact, a `LEAD` property and the lead |
| `GET /api/property/lead/{token}` | the lead behind a public token; the first read stamps `viewedAt` |
| `POST /api/property/lead/{token}/valuation-request` | stamps the request and mails the team; idempotent |
| `POST /api/property/{id}/enquiry` | accepts a visitor's enquiry about a published property (`submitPropertyEnquiry`); 202 = accepted (honeypot hits and rate-limit drops too), 503 = not stored |

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
strings (they order lexicographically) or parse them yourself.
