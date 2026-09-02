---
name: obsidian-bases
description: "Create and edit Obsidian Bases (.base) files with views, filters, formulas, and summaries. Ported from kepano/obsidian-skills."
---

# Obsidian Bases Skill

Ported from [kepano/obsidian-skills](https://github.com/kepano/obsidian-skills).

Base files use the `.base` extension and contain valid YAML. They provide database-like views of notes: tables, cards, lists, and maps with filters and computed formulas.

## Schema

```yaml
# Global filters apply to ALL views in the base
filters:
  and: []
  or: []
  not: []

# Define formula properties used across all views
formulas:
  formula_name: 'expression'

# Display names and settings for properties
properties:
  property_name:
    displayName: "Display Name"
  formula.formula_name:
    displayName: "Formula Display Name"

# Custom summary formulas
summaries:
  custom_summary: 'values.mean().round(3)'

# One or more views
views:
  - type: table | cards | list | map
    name: "View Name"
```

## Filters

Filters select which notes appear in the base. Can be a single filter string or a recursive filter object:

```yaml
filters:
  and:
    - tag:#project
    - property:status
      value: active
  or:
    - folder:Projects
    - tag:#important
  not:
    - tag:#archived
```

**Filter types:** `tag:`, `folder:`, `property:` with `value`, date ranges.

## Views

| Type | Description |
|------|-------------|
| `table` | Tabular display with columns |
| `cards` | Card-based layout |
| `list` | Simple list |
| `map` | Geographic map view |

Each view uses `order` to specify which properties/columns to display and in what order.

## Formulas

Define computed properties using Obsidian's formula language:

```yaml
formulas:
  days_until_due: '(date(due_date) - today()).days'
  urgency: |
    if(
      days_until_due < 0,
      "overdue",
      if(days_until_due < 3, "urgent", "normal")
    )
  effort_score: '(priority_num * complexity).round(1)'
```

## Workflow

1. **Create the file**: Write a `.base` file in the vault with valid YAML
2. **Define scope**: Add `filters` to select which notes appear (by tag, folder, property)
3. **Add formulas** (optional): Define computed properties
4. **Configure views**: Add one or more views with `order` for display properties
5. **Validate**: Check YAML syntax, verify referenced properties and formulas exist
6. **Test in Obsidian**: Open the `.base` file to confirm rendering

## Common Pitfalls

- Unquoted strings containing special YAML characters break parsing
- Mismatched quotes in formula expressions cause silent failures
- Referencing `formula.X` without defining `X` in `formulas` produces empty columns
- Duration and division operations have specific syntax — access `.days` before rounding, not `(date1 - date2) / 86400000`
