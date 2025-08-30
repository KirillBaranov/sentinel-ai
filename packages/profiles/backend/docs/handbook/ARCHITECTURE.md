# Architecture Handbook (Backend, C#)

## Layering (Clean-ish)
- `src/Domain/**` (index: 1) — Entities, ValueObjects, domain events (no infra).
- `src/Application/**` (index: 2) — UseCases, DTOs, interfaces to infra.
- `src/Infrastructure/**` (index: 3) — EF Core, Repos, external services.
- `src/API/**` (index: 4) — ASP.NET endpoints, DI, composition root.

**Rule:** a layer with a higher index may depend on a lower one, but not vice versa.

## Module boundaries
- No references to `*.Internal.*` of other modules.
- Prefer interfaces in `Application`, implemented in `Infrastructure`.
