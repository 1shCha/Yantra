# Repository instructions

## UI regression checks

For every UI-related implementation or fix, read and apply
[ui-render-regression-check](.agents/skills/ui-render-regression-check/SKILL.md)
before completing the task. This includes components, styles, navigation, editors,
canvas interactions, and stores/shared/backend transformations that affect rendered
state. Documentation-only and unrelated backend changes do not trigger this rule.

Run `pnpm check:ui-regressions` after relevant changes, extend coverage when the
changed behavior is not exercised, and fix demonstrated regressions within the
authorized task. Preserve required UI updates and save locks. Report blocked or
skipped checks explicitly; do not describe them as passing. The skill defines the
review and verification procedure.
