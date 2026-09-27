# Adibilis satellite template

A minimal Next.js shop site wired to an Adibilis CORE install through `@adbls/sdk`. Copy it,
rename it, and build your shop on top.

It is deliberately small. Its job is to demonstrate the two boundaries that matter and to give you a
starting point that already gets them right.

## Setup

```bash
cp .env.example .env.local    # fill in ADIBILIS_BASE_URL and ADIBILIS_API_KEY
pnpm install
pnpm dev
```

## The two boundaries

### 1. The API key never reaches the browser

`src/lib/adibilis.ts` is the *only* place the key is read, and it is only ever imported from route
handlers. The browser calls **your** route handler (`/api/holidays`); it never calls CORE directly.

This is enforced by the build, not by convention: `@adbls/sdk/server` resolves, under the
`browser` export condition, to a module that throws. Import it from a client component and the
build fails:

```
Error: The export createAdibilisClient was not found in module
       .../dist/server-in-browser-error.js [app-client]
```

Two rules follow:

- **Never prefix the key `NEXT_PUBLIC_`.** Anything so prefixed is inlined into the browser bundle
  and served to every visitor.
- **Never import `@adbls/sdk/server` from a `'use client'` file.** Use a route handler or a server
  component.

### 2. The client is built lazily, on first request

Not at module scope — deliberately. Next evaluates route modules during `next build` to collect page
data, so a client constructed at module scope makes the **build itself** require production
credentials. You would need real secrets in CI just to compile. Reading the environment on first use
keeps the build secret-free while still failing loudly the first time a request needs the key.

## What each file shows

| File | Demonstrates |
|---|---|
| `src/lib/adibilis.ts` | lazy construction, clear error on missing env, imported only from route handlers |
| `src/app/api/holidays/route.ts` | server-side use of `@adbls/sdk/server` |
| `src/app/page.tsx` | browser-safe use of `@adbls/sdk` — `isHoliday`, `makeAddressSchema` |

## The injected-message contract

The SDK bundles **no language**. Every user-facing validation string is supplied by you:

```typescript
const messages = { firstNameRequired: 'First name is required', /* …5 more */ };
makeAddressSchema(messages);
```

`src/app/page.tsx` uses an inline English map to keep the template readable. Swap it for your i18n
lookup — the SDK neither knows nor cares which language it is.

## What is deliberately absent

- **No `stripe`, no `nodemailer`.** Payment and confirmation email belong to CORE, not to a satellite.
  A satellite that talks to Stripe directly is reimplementing what CORE already owns.
- **No cart model.** Cart shape is genuinely shop-specific; the SDK models fulfilment (pickup vs
  delivery, dates, addresses), not what you sell.
