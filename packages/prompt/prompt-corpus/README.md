# @atlasai/atsh-prompt-corpus

The L2 RAG index layer of the prompt-assembly cost-reduction system: indexes
instruction corpora over the MemoryStore recall seam to support relevance-gated
prompt selection.

## Service: `ctx.promptCorpus`

Mount the package as a plugin after a `memoryStore` backend; it registers
`ctx.promptCorpus`. Requires the `@atlasai/atsh-memory` service (SQLite
backend is the zero-dependency default).

```ts
import * as memory from '@atlasai/atsh-memory'
import PromptCorpusService from '@atlasai/atsh-prompt-corpus'

await ctx.plugin(memory, { backend: 'sqlite', sqlite: { path: ':memory:' } })
await ctx.plugin(PromptCorpusService)
```

### `ingest(document, options)`

Chunks a corpus document at semantic boundaries (ATX heading / section split)
and retains each typed chunk as a memory-store record carrying structured
metadata (`corpus`, `scope`, `specificityRank`, `cacheStable`, plus the chunk's
index/heading/depth). Returns the retained count and the labels applied.

Every chunk is retained in the `prompt:<corpus>` namespace so prompt-corpus
chunks stay addressable independently of ordinary agent memory and recall can
scope to a single corpus or span them. Ingesting the same document twice
retains duplicate records — deduplication is the caller's concern at load time.

### `reflect(options?)`

Reports the current index size: total retained chunks and the count per
corpus. Scopes to one corpus via the namespaced memory reflect options when
passed.

### `recall(query, options?)`

Ranks the index against a working-intent query and returns the best chunks,
delegating to the underlying MemoryStore hybrid recall (lexical overlap by
default; embeddings when the backend is configured with one — zero embed
config works out of the box). When `options.corpus` names a single corpus,
recall scopes to that corpus' `prompt:<corpus>` namespace; when omitted it
spans all prompt corpora. Each result carries the chunk content, the memory
namespace, the corpus label it was ingested under, and the backend 0..1
`score`, so an assembler can order by germane corpus without re-parsing the
store.

## Model / token effects

Each retained chunk stores its full text verbatim plus metadata. The index
grows by one memory record per chunk, so prompt-corpus memory is
proportional to the instruction corpora ingested.

## Known Limitations and Deferred Work

- Retrieval selection (`recall`) is implemented (see `recall(query, options?)`
  above). Note: cross-corpus recall queries a widened slice of the whole
  store and filters to `prompt:` namespaces; on a store that also holds large
  volumes of ordinary agent memory, a low-match prompt chunk can be crowded
  out of that widened slice. Callers that need a guaranteed recall from one
  corpus should pass `options.corpus` to scope directly.
- `cacheStable` is recorded per chunk but not yet acted on by an assembler;
  `@atlasai/atsh-prompt-lume` will consume it.