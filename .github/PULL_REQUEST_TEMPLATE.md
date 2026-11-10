## What and why

<!-- What does this change, and why? Link the issue it closes, e.g. "Closes #12". -->

## How it was tested

<!-- What you ran and what you checked by hand. Say which engine (mock or Claude), and which devices if a phone is involved. -->

## Pictures

<!-- For a change to the interface: before and after, taken in demo mode (?demo). Delete this section otherwise. -->

## Checklist

- [ ] The title follows [Conventional Commits](https://www.conventionalcommits.org) (`feat:`, `fix:`, `docs:`, `refactor:`, `chore:`).
- [ ] `pnpm check` passes.
- [ ] If the desktop shell changed: `cargo fmt --all -- --check`, `cargo clippy --locked --all-targets -- -D warnings` and `cargo test --locked` pass in `apps/desktop/src-tauri`.
- [ ] If the protocol changed: it changed first, in `packages/protocol`, and the rebuilt schema is in this pull request, with the Swift mirror.
- [ ] New words exist in English and in French, and use the vocabulary of `docs/DESIGN.md`.
- [ ] No new setting where a better default would do.
- [ ] Docs and `CHANGELOG.md` updated if behaviour changed.
