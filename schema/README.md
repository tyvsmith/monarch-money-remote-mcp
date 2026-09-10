# Monarch GraphQL schema (vendored)

Monarch disables introspection for users, but the web app bundle at
`https://static.monarch.com/static/js/main.<hash>.js` embeds the full
introspection result inside `JSON.parse('{"__schema":...}')`, plus every
named operation the web app uses.

- `npm run extract-schema` downloads the current bundle, regenerates
  `schema/monarch.graphql`, and rewrites `docs/research/monarch-api-<date>/web-app-ops/`.
- `npm run check-ops` validates every `*_Q` export under `src/monarch/ops/`
  against the SDL, so a renamed field fails locally instead of returning a 400
  in production.
