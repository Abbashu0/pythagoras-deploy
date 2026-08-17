# Knowledge Graphs — Full (Unfiltered)

This branch contains the complete, unfiltered knowledge graphs for the Pythagoras Platform project.

## Files

| File | Nodes | Edges | Size | Description |
|------|-------|-------|------|-------------|
| `graphify-graph.json` | 8,122 | 27,177 | ~14 MB | Graphify AST-based graph |
| `graphify-report.md` | — | — | ~20 KB | Graphify analysis report |
| `graphify-interactive.html` | — | — | — | Interactive HTML (if available) |
| `understand-anything-graph.json` | 10,195 | 9,579 | ~6 MB | Understand Anything semantic graph |

## How to Use

### Graphify
```bash
# Install graphify CLI
uv tool install graphifyy

# Query the graph
graphify query "how does auth work?"
graphify explain "AdminShell"
graphify path "ComponentA" "ServiceB"
```

### Understand Anything
Open the JSON in any JSON viewer, or use the Understand Anything dashboard:
```bash
npx https://github.com/Egonex-AI/Understand-Anything/releases/latest/download/understand-anything-viewer.tgz .
```

## How to Rebuild

```bash
# Graphify
graphify . --code-only

# Understand Anything
node scripts/understand/build-graph.mjs
```

## Note
These graphs are on a separate branch to avoid bloating the main branch.
They are rebuilt automatically on every `git commit` via post-commit hooks.
