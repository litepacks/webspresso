# Version upgrade guides

Webspresso follows [semver](https://semver.org/). During **0.1.x** stabilization, changes are **additive** unless noted in [CHANGELOG.md](../../CHANGELOG.md).

| Version | Guide |
|---------|--------|
| 0.1.0-alpha | [0.1.0-alpha.md](0.1.0-alpha.md) |
| 0.1.x (stabilization) | [0.1.x.md](0.1.x.md) |
| Future breaking releases | Use [TEMPLATE.md](TEMPLATE.md) |

## Recommended upgrade flow

1. Read the guide for your target version.
2. Update `webspresso` in `package.json` and reinstall.
3. Run `npx webspresso doctor --db`.
4. Run `npx webspresso db:migrate` if ORM migrations changed.
5. Run your test suite and smoke critical routes.

## Reporting issues

Open an issue on GitHub with your current version, adapter (Node / Cloudflare / Bun), and relevant plugin list.
