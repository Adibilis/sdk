// Reached only through the export map's `browser` condition — i.e. when a bundler is building
// @adbls/sdk/server into a BROWSER bundle. That would ship the WEBSITE API key to every
// visitor, so fail the build loudly instead.
//
// This replaces React's `server-only` marker, which resolves to a throwing module under every
// condition except `react-server`. That made the server entry unusable outside Next: a plain
// Node server importing it threw at runtime. The `browser` condition is understood by every
// major bundler, so the guard now works everywhere AND the entry runs anywhere server-side.
throw new Error(
    '@adbls/sdk/server was imported into a browser bundle. It holds the WEBSITE API key and ' +
        'must only be used server-side — from a route handler, a server component, or a Node server. ' +
        'Import from "@adbls/sdk" instead for anything a client component needs.'
);
