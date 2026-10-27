# graph: graphs for algorithms: BFS, DFS, and Dijkstra traced step by step, with adjacency lists and matrices

Directed or undirected, optionally weighted. Graphviz places the nodes; techviz draws straight
edges and the run's state. For any directed graph or block diagram without a run, `fsm` with
`dot` also works; use `graph` when an algorithm, weights, or adjacency views matter.

## Fields

- `edges`: `"A-B"` (undirected) or `"A->B"` (directed), with an optional weight: `"A-B 4"`.
  All edges use the same arrow; once one has a weight, all need one. Names are letters,
  digits, and `_`. Nodes come from the edges, sorted by name.
- `nodes`: names to add (isolated nodes) or to fix the order of nodes and matrix rows.
- `run`: `"bfs"`, `"dfs"` (recursive), or `"dijkstra"`, from `start` (a node name). Each visit
  is a step (a static render shows the end; `"step": k` picks one). Visited nodes fill green,
  the current one is red, waiting ones (queue, stack, open set) are outlined amber, and tree
  edges (BFS tree, DFS tree, shortest paths) are thick green; DFS back edges are dashed.
  BFS shows the visit number by each node and the queue below; DFS shows d/f times and the
  recursion stack; Dijkstra shows each node's current distance (∞ until reached).
- `order`: `"alpha"` (neighbors visited in name order, default) or `"given"` (edge order).
- `detail: true` (dfs): adds a step when each node finishes.
- `view`: `"list"` (adjacency list: each node's neighbors in visiting order, with weights),
  `"matrix"` (adjacency matrix: 0/1, or weights with blanks), or both: `["list", "matrix"]`.
  Drawn below the graph.
- `layout`: `"auto"` (default, spring layout), `"circle"`, or `"layered"` (top to bottom;
  good for DAGs and trees).
- `highlight`: node names and edges (`"A-B"`, `"A->B"`), drawn red.

Summary: direction, weights, counts, the edge list, degrees (in/out when directed); then for
bfs the visit order, levels (edges from start), tree edges, and unreachable nodes; for dfs the
visit order, d/f times, tree and back edges, and whether a cycle is reachable; for dijkstra
each distance with its path and the order nodes were taken. Errors: bad edge syntax, mixed
`-` and `->`, a missing start. Warnings: negative weights with dijkstra.

Keep graphs to about 8 nodes so weights and labels stay readable at panel width.

## Examples

```json
{"v":1,"kind":"graph","edges":["S-A 7","S-B 2","A-B 3","A-C 4","B-C 8","C-T 5","B-T 9"],"run":"dijkstra","start":"S","view":"matrix"}
```

```json
{"v":1,"kind":"graph","edges":["1->2","1->3","2->4","3->4","4->5"],"run":"dfs","start":"1","layout":"layered"}
```
