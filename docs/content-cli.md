# Content CLI

| Command | Description |
|---------|-------------|
| `webspresso content:list` | List collections with published/draft counts |
| `webspresso content:validate` | Warn on schema/title issues (`--strict` exits 1) |
| `webspresso content:build-index` | Output JSON index (`-o path` to write file) |
| `webspresso content:new <collection> <slug>` | Create a starter `.md` file |

## Examples

```bash
webspresso content:list
webspresso content:validate --strict
webspresso content:build-index -o .webspresso/cache/content-index.json
webspresso content:new blog my-post --title "My Post"
```

## Production build

`webspresso build` embeds `manifest.contentIndex` when `content/` exists. Manifest mode loads pre-parsed items without re-reading Markdown at runtime.
