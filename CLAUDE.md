# Enceladus — Claude Instructions

Before doing any work, read ARCHITECTURE.md to understand the current state of the app.

After any change that affects statuses, columns, data format, or interaction model, update ARCHITECTURE.md to reflect the new state.

## Working rules (agreed 2026-08-24)

1. No code changes until the user has explicitly agreed to the plan.
2. No architecture teardown/rewrite without prior agreement — favour local, incremental changes over broad rewrites unless the user signs off on a bigger change first.
3. Any data format change must stay backward compatible with older `tasks.json` versions — old files must load correctly and be converted to the new format on first open (extend the existing migration logic in `TaskStore.load`, don't replace it).
