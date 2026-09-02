---
name: json-canvas
description: "Create and edit JSON Canvas (.canvas) files with nodes, edges, groups, and connections for Obsidian canvases, mind maps, flowcharts, and project boards. Ported from kepano/obsidian-skills."
---

# JSON Canvas Skill (for Obsidian .canvas files)

Ported from [kepano/obsidian-skills](https://github.com/kepano/obsidian-skills).

Canvas files use the `.canvas` extension and follow the [JSON Canvas Spec 1.0](https://jsoncanvas.org/spec/1.0/).

## File Structure

```json
{
  "nodes": [],
  "edges": []
}
```

- `nodes` (optional): Array of node objects
- `edges` (optional): Array of edge objects connecting nodes

## Node Types

### Text Node

```json
{
  "id": "16-char-hex-id",
  "type": "text",
  "x": 0,
  "y": 0,
  "width": 300,
  "height": 150,
  "text": "# Markdown content here"
}
```

### File Node

```json
{
  "id": "16-char-hex-id",
  "type": "file",
  "x": 0,
  "y": 0,
  "width": 250,
  "height": 150,
  "file": "path/to/file.md",
  "subpath": "#Heading or ^block-id"
}
```

### Link Node

```json
{
  "id": "16-char-hex-id",
  "type": "link",
  "x": 0,
  "y": 0,
  "width": 250,
  "height": 100,
  "url": "https://example.com"
}
```

### Group Node

```json
{
  "id": "16-char-hex-id",
  "type": "group",
  "x": 0,
  "y": 0,
  "width": 300,
  "height": 500,
  "label": "Group Name"
}
```

### Optional fields (all node types)

- `color`: "1" through "6" (Obsidian's 6 color palette)
- `id`: required — 16-character hex string, must be unique across nodes AND edges

## Edges

```json
{
  "id": "16-char-hex-id",
  "fromNode": "source-node-id",
  "fromSide": "top",
  "fromEnd": "none",
  "toNode": "target-node-id",
  "toSide": "bottom",
  "toEnd": "arrow",
  "label": "edge label",
  "color": "1"
}
```

**Fields:**
- `id`: Required — 16-char hex, unique across all nodes and edges
- `fromNode` / `toNode`: Required — must reference existing node IDs
- `fromSide` / `toSide`: Optional — `top`, `right`, `bottom`, `left`
- `fromEnd` / `toEnd`: Optional — `none`, `arrow`
- `label`: Optional — descriptive text
- `color`: Optional — "1" through "6"

## Workflows

### Create a New Canvas

1. Generate unique 16-character hex IDs for each node (e.g., `crypto.randomBytes(8).toString("hex")` in Node.js, or `openssl rand -hex 8` in shell)
2. Create `.canvas` file with `{"nodes": [...], "edges": [...]}`
3. **Validate:** JSON parses, all edge `fromNode`/`toNode` exist in nodes, no duplicate IDs

### Add Node to Existing Canvas

1. Read and parse the `.canvas` file
2. Generate a unique non-colliding ID
3. Position (`x`, `y`) to avoid overlapping existing nodes (leave 50-100px spacing)
4. Append the node to `nodes` array
5. Optionally add edges

### Connect Two Nodes

1. Identify source and target node IDs
2. Create edge with `fromNode` and `toNode`
3. Set `fromSide`/`toSide` for anchor points (top, right, bottom, left)
4. Optionally set `label` for descriptive text

## Examples

### Simple Mind Map

```json
{
  "nodes": [
    {"id": "8a9b0c1d2e3f4a5b", "type": "text", "x": 0, "y": 0, "width": 300, "height": 150, "text": "# Main Idea"},
    {"id": "1a2b3c4d5e6f7a8b", "type": "text", "x": 400, "y": -100, "width": 250, "height": 100, "text": "## Supporting A"},
    {"id": "2b3c4d5e6f7a8b9c", "type": "text", "x": 400, "y": 100, "width": 250, "height": 100, "text": "## Supporting B"}
  ],
  "edges": [
    {"id": "3c4d5e6f7a8b9c0d", "fromNode": "8a9b0c1d2e3f4a5b", "fromSide": "right", "toNode": "1a2b3c4d5e6f7a8b", "toSide": "left"},
    {"id": "4d5e6f7a8b9c0d1e", "fromNode": "8a9b0c1d2e3f4a5b", "fromSide": "right", "toNode": "2b3c4d5e6f7a8b9c", "toSide": "left"}
  ]
}
```

### Kanban Board

```json
{
  "nodes": [
    {"id": "5e6f7a8b9c0d1e2f", "type": "group", "x": 0, "y": 0, "width": 300, "height": 500, "label": "To Do", "color": "1"},
    {"id": "6f7a8b9c0d1e2f3a", "type": "group", "x": 350, "y": 0, "width": 300, "height": 500, "label": "In Progress", "color": "3"},
    {"id": "7a8b9c0d1e2f3a4b", "type": "group", "x": 700, "y": 0, "width": 300, "height": 500, "label": "Done", "color": "4"},
    {"id": "8b9c0d1e2f3a4b5c", "type": "text", "x": 20, "y": 50, "width": 260, "height": 80, "text": "## Task 1\n\nImplement X"},
    {"id": "9c0d1e2f3a4b5c6d", "type": "text", "x": 370, "y": 50, "width": 260, "height": 80, "text": "## Task 2\n\nReview PR", "color": "2"},
    {"id": "0d1e2f3a4b5c6d7e", "type": "text", "x": 720, "y": 50, "width": 260, "height": 80, "text": "## Task 3\n\n~~Done~~"}
  ],
  "edges": []
}
```

### Flowchart

```json
{
  "nodes": [
    {"id": "a0b1c2d3e4f5a6b7", "type": "text", "x": 200, "y": 0, "width": 150, "height": 60, "text": "**Start**", "color": "4"},
    {"id": "b1c2d3e4f5a6b7c8", "type": "text", "x": 200, "y": 100, "width": 150, "height": 60, "text": "Step 1:\nGather data"},
    {"id": "c2d3e4f5a6b7c8d9", "type": "text", "x": 200, "y": 200, "width": 150, "height": 80, "text": "**Decision**\n\nIs data valid?", "color": "3"},
    {"id": "d3e4f5a6b7c8d9e0", "type": "text", "x": 400, "y": 200, "width": 150, "height": 60, "text": "Process data"},
    {"id": "e4f5a6b7c8d9e0f1", "type": "text", "x": 0, "y": 200, "width": 150, "height": 60, "text": "Request new data", "color": "1"},
    {"id": "f5a6b7c8d9e0f1a2", "type": "text", "x": 400, "y": 320, "width": 150, "height": 60, "text": "**End**", "color": "4"}
  ],
  "edges": [
    {"id": "a6b7c8d9e0f1a2b3", "fromNode": "a0b1c2d3e4f5a6b7", "fromSide": "bottom", "toNode": "b1c2d3e4f5a6b7c8", "toSide": "top"},
    {"id": "b7c8d9e0f1a2b3c4", "fromNode": "b1c2d3e4f5a6b7c8", "fromSide": "bottom", "toNode": "c2d3e4f5a6b7c8d9", "toSide": "top"},
    {"id": "c8d9e0f1a2b3c4d5", "fromNode": "c2d3e4f5a6b7c8d9", "fromSide": "right", "toNode": "d3e4f5a6b7c8d9e0", "toSide": "left", "label": "Yes", "color": "4"},
    {"id": "d9e0f1a2b3c4d5e6", "fromNode": "c2d3e4f5a6b7c8d9", "fromSide": "left", "toNode": "e4f5a6b7c8d9e0f1", "toSide": "right", "label": "No", "color": "1"},
    {"id": "e0f1a2b3c4d5e6f7", "fromNode": "e4f5a6b7c8d9e0f1", "fromSide": "top", "toNode": "b1c2d3e4f5a6b7c8", "toSide": "left", "fromEnd": "none", "toEnd": "arrow"},
    {"id": "f1a2b3c4d5e6f7a8", "fromNode": "d3e4f5a6b7c8d9e0", "fromSide": "bottom", "toNode": "f5a6b7c8d9e0f1a2", "toSide": "top"}
  ]
}
```
