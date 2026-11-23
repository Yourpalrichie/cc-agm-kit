# Releasing

Foundry offers an update only when the released `module.json` has a **higher version** than the
one installed. Pushing to `main` without a version bump changes nothing for the GM.

## Steps

1. Bump `version` in `module.json` (semver, `MAJOR.MINOR.PATCH`):
   - **patch** (`0.2.0` → `0.2.1`): bug fixes only.
   - **minor** (`0.2.1` → `0.3.0`): new tools or features; existing worlds keep working.
   - **major** (`0.3.0` → `1.0.0`): changes that break saved data or need the GM to redo setup.
2. Update the `download` URL in `module.json` to the new version (optional: the release Action
   rewrites it in the released copy anyway).
3. Commit and push to `main`:

   ```bash
   git commit -am "v0.2.1: <what changed>"
   git push
   ```

4. The **Release** Action (`.github/workflows/release.yml`) sees there's no `v0.2.1` release yet,
   builds `module.zip` (module files at the zip root), writes the matching `download` URL into
   `module.json`, and publishes release `v0.2.1` with both files attached. Check it under the
   repo's **Actions** and **Releases** tabs, or run `gh release view v0.2.1`.
5. The GM clicks **Check for Updates** in Foundry's Add-on Modules.

Pushes that don't change the version are skipped by the Action. To check the zip locally, run
`bash .github/build-release.sh`; it writes `dist/module.json` and `dist/module.zip` (ignored by git).
Don't delete or re-use a released version number; bump again instead.
