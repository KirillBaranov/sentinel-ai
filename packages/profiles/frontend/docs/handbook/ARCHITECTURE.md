# Architecture Handbook (Frontend)

## Module boundaries
Features must not import each other directly. Use a shared port/adapter.

**Allowed**
- `feature-a` → `shared/ports/<adapter>.ts` → `feature-b/public-api.ts`

**Forbidden**
- `feature-a/*` → `feature-b/internal/*`

## Public vs Internal
- `public-api.ts` — everything that can be imported from outside.
- `internal/*` — private to the feature; external imports are forbidden.

## Layers (example)
- `src/shared/**` (index: 1) — base utilities, ports/adapters.
- `src/features/*/**` (index: 2) — business features.
- `src/app/**` (index: 3) — application assembly, routing, DI.

**Rule:** a layer with a higher index may depend on a lower one, but not vice versa.
