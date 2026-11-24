# cc-agm-kit: notes for Claude sessions

Foundry VTT module (v13 only, verified 13.351; PF1 system 11.11+). The GM installs it from
`https://github.com/Yourpalrichie/cc-agm-kit/releases/latest/download/module.json`.

## Releasing: bump the version when a change is ready for the GM

The GM's Foundry only sees an update when `version` in `module.json` goes up. The Release Action
publishes `v<version>` on a push to `main` only if that version has no release yet. See RELEASING.md.

- When Richie says a change is ready for the GM (or "release it", "ship it to the GM"), bump
  `version` in `module.json` in the same commit, using semver:
  - patch (0.2.0 → 0.2.1): bug fixes only
  - minor (0.2.1 → 0.3.0): new tools or features; existing worlds keep working
  - major (→ 1.0.0): breaks saved data or needs the GM to redo setup
- Say which bump you made and why. If it's unclear whether a change is GM-ready or which bump
  fits, ask Richie.
- Don't bump for work in progress, and never reuse or lower a released version.
- Leave the `download` URL alone or point it at the new version; the Action rewrites it in the
  released copy either way.
- New top-level folders the module needs at runtime must be added to `INCLUDE` in
  `.github/build-release.sh`, or they won't be in the zip.

## Git and GitHub

- Commit with the repo-local identity (check `git config user.email` is the
  `users.noreply.github.com` address first). Never commit with the global git identity.
- Richie runs pushes himself; give him the commands, each in its own block:
  `gh auth switch --user Yourpalrichie`, then `git push`, then `gh auth switch --user Yourpalrichie27`.
- After a release push, check the run with `gh run list --workflow release.yml --limit 1`
  and `gh release view v<version>`.

## Content

The repo is public. Keep Paizo material to short rules summaries with Archives of Nethys links;
don't paste full rules entries, adventure text or stat blocks into code, fixtures or docs.
