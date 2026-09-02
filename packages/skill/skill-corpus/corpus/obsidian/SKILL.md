---
name: obsidian
description: "Read, search, create, and edit notes in the Obsidian vault using Obsidian Flavored Markdown (OFM) with wikilinks, embeds, callouts, properties, tags, and block IDs. Enhanced from kepano/obsidian-skills."
---

# Obsidian Vault — Enhanced Edition

Enhanced Atlas vault integration ported from [kepano/obsidian-skills](https://github.com/kepano/obsidian-skills).

Use this skill for filesystem-first Obsidian vault work: reading notes, listing notes, searching note files, creating notes, appending content, adding wikilinks, callouts, embeds, and properties.

## Vault path

Use a known or resolved vault path before calling file tools.

The documented vault-path convention is the `OBSIDIAN_VAULT_PATH` environment variable, for example from `~/.Atlas/.env`. If it is unset, use `~/Documents/Obsidian Vault`.

File tools do not expand shell variables. Do not pass paths containing `$OBSIDIAN_VAULT_PATH` to `read_file`, `write_file`, `patch`, or `search_files`; resolve the vault path first and pass a concrete absolute path. Vault paths may contain spaces, which is another reason to prefer file tools over shell commands.

If the vault path is unknown, `terminal` is acceptable for resolving `OBSIDIAN_VAULT_PATH` or checking whether the fallback path exists. Once the path is known, switch back to file tools.

## Read a note

Use `read_file` with the resolved absolute path to the note. Prefer this over `cat` because it provides line numbers and pagination.

## List notes

Use `search_files` with `target: "files"` and the resolved vault path. Prefer this over `find` or `ls`.

- To list all markdown notes, use `pattern: "*.md"` under the vault path.
- To list a subfolder, search under that subfolder's absolute path.

## Search

Use `search_files` for both filename and content searches. Prefer this over `grep`, `find`, or `ls`.

- For filenames, use `search_files` with `target: "files"` and a filename `pattern`.
- For note contents, use `search_files` with `target: "content"`, the content regex as `pattern`, and `file_glob: "*.md"` when you want to restrict matches to markdown notes.

## Create a note

Use `write_file` with the resolved absolute path and the full markdown content. Prefer this over shell heredocs or `echo` because it avoids shell quoting issues and returns structured results.

**Recommended structure:**
1. Add YAML frontmatter with properties (title, tags, aliases) at the top
2. Write content using standard Markdown for structure, plus Obsidian-specific syntax
3. Link related notes using `[[wikilinks]]` for internal vault connections
4. Embed content from other notes, images, or PDFs using `![[embed]]` syntax
5. Add callouts for highlighted information using `> [!type]` syntax

## Append / edit a note

Prefer a native file-tool workflow:

- Read the target note with `read_file`.
- Use `patch` for an anchored edit when there is stable context, such as adding a section after an existing heading.
- Use `write_file` when rewriting the whole note is clearer than constructing a fragile patch.
- For simple appends with no stable context, `terminal` is acceptable.

## Targeted edits

Use `patch` for focused note changes when the current content gives you stable context. Prefer this over shell text rewriting.

---

## Obsidian Flavored Markdown Reference

### Internal Links (Wikilinks)

```markdown
[[Note Name]]                          Link to note
[[Note Name|Display Text]]             Custom display text
[[Note Name#Heading]]                  Link to heading
[[Note Name#^block-id]]                Link to block
[[#Heading in same note]]              Same-note heading link
```

Define a block ID by appending `^block-id` to any paragraph:

```markdown
This paragraph can be linked to. ^my-block-id
```

For lists and quotes, place the block ID on a separate line after the block:

```markdown
> A quote block

^quote-id
```

> **Rule:** Use `[[wikilinks]]` for notes within the vault (Obsidian tracks renames automatically) and `[text](url)` for external URLs only.

### Embeds

Prefix any wikilink with `!` to embed its content inline:

```markdown
![[Note Name]]                         Embed full note
![[Note Name#Heading]]                 Embed section
![[Note Name#^block-id]]               Embed block
```

**Images:**

```markdown
![[image.png]]
![[image.png|640x480]]                 Width x Height
![[image.png|300]]                     Width only (maintains aspect ratio)
```

**External Images:**

```markdown
![Alt text](https://example.com/image.png)
![Alt text|300](https://example.com/image.png)
```

**Audio & PDF:**

```markdown
![[audio.mp3]]
![[audio.ogg]]
![[document.pdf]]
![[document.pdf#page=3]]
```

**Search results embed:**

````markdown
```query
tag:#project status:done
```
````

### Callouts

Callouts highlight information in colored boxes with icons:

```markdown
> [!note]
> This is a note callout.

> [!info] Custom Title
> This callout has a custom title.
```

**Foldable callouts:**

```markdown
> [!faq]- Collapsed by default
> Hidden until expanded.

> [!faq]+ Expanded by default
> Visible but collapsible.
```

**Nested callouts:**

```markdown
> [!question] Outer
> > [!note] Inner
> > Nested content
```

**Supported callout types:**

| Type | Aliases | Color |
|------|---------|-------|
| `note` | — | Blue |
| `abstract` | `summary`, `tldr` | Teal |
| `info` | — | Blue |
| `todo` | — | Blue |
| `tip` | `hint`, `important` | Cyan |
| `success` | `check`, `done` | Green |
| `question` | `help`, `faq` | Yellow |
| `warning` | `caution`, `attention` | Orange |
| `failure` | `fail`, `missing` | Red |
| `danger` | `error` | Red |
| `bug` | — | Red |
| `example` | — | Purple |
| `quote` | `cite` | Gray |

### Properties (Frontmatter)

```yaml
---
title: My Note Title
date: 2024-01-15
tags:
  - project
  - important
aliases:
  - My Note
  - Alternative Name
cssclasses:
  - custom-class
status: in-progress
rating: 4.5
completed: false
due: 2024-02-01T14:30:00
---
```

**Property types:**

| Type | Example |
|------|---------|
| Text | `title: My Title` |
| Number | `rating: 4.5` |
| Checkbox | `completed: true` |
| Date | `date: 2024-01-15` |
| Date & Time | `due: 2024-01-15T14:30:00` |
| List | `tags: [one, two]` or YAML list |
| Links | `related: "[[Other Note]]"` |

**Default properties:** `tags` (searchable, shown in graph), `aliases` (alternative names for link suggestions), `cssclasses` (CSS classes applied in reading/editing view).

### Tags

```markdown
#tag
#nested/tag
#tag-with-dashes
#tag_with_underscores
```

Tags can contain: letters (any language), numbers (not first character), underscores `_`, hyphens `-`, forward slashes `/` (for nesting).

In frontmatter:

```yaml
---
tags:
  - tag1
  - nested/tag2
---
```

---

## Obsidian CLI

When running in an environment with Obsidian open (Windows host), use the `obsidian` CLI to interact with the vault via terminal.

```bash
obsidian read file="My Note"
obsidian create name="New Note" content="# Hello" template="Template" silent
obsidian append file="My Note" content="New line"
obsidian search query="search term" limit=10
obsidian daily:read
obsidian daily:append content="- [ ] New task"
obsidian property:set name="status" value="done" file="My Note"
obsidian tasks daily todo
obsidian tags sort=count counts
obsidian backlinks file="My Note"
```

Syntax: parameters use `=`, quote values with spaces. Flags are boolean switches:

```bash
obsidian create name="My Note" content="Hello world"
obsidian create name="My Note" silent overwrite
```

Use `file=<name>` (resolves like wikilink) or `path=<path>` (exact vault path). Use `vault=<name>` to target a specific vault.

For multiline content use `\n` for newline and `\t` for tab.
