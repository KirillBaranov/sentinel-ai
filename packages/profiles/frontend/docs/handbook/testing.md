# Testing Handbook (Frontend)

## General principles
- Every change to a **public API** (exported function, component, or utility) must be covered by unit tests.
- Prefer small, focused tests over large integration tests unless integration is explicitly required.
- Keep tests deterministic: avoid hidden dependencies on time, randomness, or environment.

## Guidelines
- **Unit tests**: validate logic of isolated functions or components.
- **Component tests**: ensure rendering, props, and events work as expected.
- **Integration tests**: use only when multiple modules need to be verified together.
- **E2E tests**: write sparingly; focus on critical flows only.

## Structure
- Test files should be colocated with source files:  
  `src/module/MyComponent.tsx` → `src/module/MyComponent.test.tsx`
- Use consistent naming: `*.test.ts` or `*.spec.ts`.
- Prefer `@testing-library/*` for UI components.

## Rules
- Avoid testing internal implementation details; focus on observable behavior.
- Do not rely on test order or shared mutable state.
- Strive for high coverage, but prioritize meaningful tests over raw numbers.
