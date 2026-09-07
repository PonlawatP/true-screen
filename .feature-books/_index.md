# Feature Books — Index

The source of truth for business logic and feature relationships.
Open this `.feature-books/` folder as an Obsidian vault and view it in Graph View (colors are preset).

> Content language is set in `.fbconfig.json` (default: English). Change it with `/fb-config set <language>`.

```dataview
TABLE status, owner, length(impacts) AS "Impacts", last_reviewed
FROM "features"
WHERE type = "feature"
SORT last_reviewed ASC
```

> Install the **Dataview** community plugin for the table to work.

## Specs

Plain-language product specs live under `specs/` — no frontmatter, no source paths, written for
someone who wants to know what a feature does and why, not how it's implemented. Create or refresh
one with `/fb-spec-new <topic>`; it checks first whether a Feature Book already exists for the
topic (most specs are written before implementation, so usually none will).

```dataview
LIST
FROM "specs"
```

## Tasks

Issue/task cards live under `tasks/`: `issues/` (new) → `decisions/` (triaged), then manually
move them to `backlog/` (accepted for later), `hold/` (blocked), or `action/` (in progress).
Terminal folders are `done/` (completed) and `cancelled/` (intentionally closed).
Create a card with `/fb-task`, triage the inbox with `/fb-triage`.

```dataview
TABLE kind, status, effort, related
FROM "tasks"
SORT created DESC
```
