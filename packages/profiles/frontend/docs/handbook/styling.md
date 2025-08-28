# Style Handbook (Frontend)

## No TODO comments
- Do not leave `// TODO:` or `/* TODO */` comments in the code.
- Always track technical debt or pending work in the issue tracker (e.g., Jira, GitHub Issues).
- Replace inline TODOs with a link or reference to the corresponding task.

**Bad**
```ts
// TODO: remove after refactor
function oldLogic() { ... }
```
**Good**
```ts
// See ISSUE-123: refactor scheduled
function oldLogic() { ... }
```

Code style
	•	Follow ESLint and Prettier configuration provided in the project.
	•	Prefer readability and consistency over cleverness.
	•	Keep functions small and focused on a single responsibility.

Naming
	•	Use descriptive names for variables, functions, and components.
	•	Avoid abbreviations unless they are industry-standard (e.g., id, URL).
	•	Consistency is more important than personal preference.

Imports
	•	Use absolute imports with project-defined path aliases.
	•	Group imports: external libraries first, internal modules after.
	•	Avoid deep imports into other features’ internal folders.

Comments
	•	Comments should explain why, not what (the code already shows what).
	•	Avoid redundant comments.
	•	Document complex decisions in ADRs instead of inline comments.
