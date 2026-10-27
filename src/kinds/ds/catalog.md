# ds: data structures as boxes and arrows (arrays, linked lists, stacks, queues, BST and AVL trees, heaps, hash tables), traced op by op

The abstract textbook picture; C memory with addresses is `memory`. One structure per spec,
named by its key. `ops` change it and the kind computes every state: each op becomes a step
(a static render shows the last; `"step": k` picks one), and the summary has the facts.

## Shared fields

- `ops`: op strings, listed per structure below. Values are numbers or short words.
- `detail: true`: intermediate states get their own steps: each pointer assignment of a list
  insert or delete (`n->next = p->next`), each heap swap, the unbalanced tree before an AVL
  rotation (and between the two of a double rotation), each swap or shift of bubble and
  insertion sort.
- `highlight`: indices (array, stack, queue, heap, hash) or values (list, tree), drawn red.
  Each op highlights what it touched; search paths and hash probes are amber.

## Structures

- `array: [5, 2, 9]`. `pointers: {"i": 0, "j": 2}` names indices (arrows under the cells).
  Ops: `swap 0 2`, `set 1 7`, `search 42` (binary search, a step per probe with lo, mid, hi;
  warns if unsorted), `sort bubble|selection|insertion|quick` (a step per pass; quick is
  Lomuto, last element as pivot). Sorted cells are shaded green.
- `list: [3, 7, 9]`. `links`: `"single"` (default) or `"double"`; `circular: true`;
  `sentinel: true` (dummy head, plus a dummy tail when double); `tail: true` (default when
  double); `pointers: {"cur": 1}` (node positions, -1 the last). NULL is a slash in the field.
  Ops: `push_front 1`, `push_back 9`, `insert 5 at 2`, `insert 5 after 3`, `delete 7`,
  `pop_front`, `pop_back`, `find 7`, `reverse`. With `detail`, temporaries `p` (the node
  before), `n` (the new node, drawn below the row), and `d` (the node to free) appear.
- `stack: [1, 2]` (bottom to top) or `queue: [1, 2]` (front to rear). `on`: `"array"`
  (default; `capacity` defaults to the most items ever held plus one; the queue is circular,
  `rear` is the index of the last item) or `"list"` (stack top = head; queue front = head,
  rear = tail). Ops: `push 3`, `pop`, `peek`; `enqueue 3`, `dequeue`. Overflow and underflow warn.
- `tree: [50, 30, 70]`: keys inserted in order into a BST. To trace the build, start with
  `[]` and list `insert` ops. `build: "level"`: the list is level order with null for a
  missing node (children of i at 2i+1, 2i+2), checked for BST order unless `bst: false`.
  `avl: true` rebalances after every op, names each rotation (LL, RR, LR, RL), and draws
  balance factors, h(L) − h(R). `show: ["bf", "height"]` labels nodes on a plain BST too.
  Ops: `insert 40`, `delete 30` (two children: the in-order successor takes its place), `find 60`.
- `heap: [5, 3, 8]`: a tree over its array, indices on both. `order`: `"min"` (default) or
  `"max"`. `build`: `"insert"` (push each, default), `"heapify"` (bottom-up), or `"array"`
  (as stored; order checked). `base`: 0 (children 2i+1, 2i+2; default) or 1. Ops: `push 4`, `pop`.
- `hash: [18, 41, 22]`: integer keys inserted in order. `m`: table size (required). `h`:
  the hash in k, taken mod m (default `"k mod m"`; `mod` and `%` work). `probe`: `"chain"`
  (default; separate chaining, appended), `"linear"`, `"quadratic"` (h + i²), or `"double"`
  (h + i·h2, with `h2` like `"7 - k mod 7"`). Ops: `insert 44`, `delete 18` (open addressing
  leaves DEL), `find 22`. The last op's probe sequence hops down the right side.

Summary: the shown state (array and whether it's sorted; the chain from head to NULL or
around the cycle, and every pointer; stack and queue contents, top, front, rear; tree size,
height in edges, in-, pre-, post-, and level-order, BST check, balance factors; heap array and
order check; every table cell and the load factor), then each op's result: search probes,
sort passes, insertion paths, rotations, sift paths, home index and probe sequence. Errors:
unknown ops, indices out of range. Warnings: binary search on an unsorted array, broken BST or
heap order, duplicate or missing keys, overflow, underflow, a full table.

Lists of about 5 nodes and trees of about 15 stay readable at panel width (300 px).

## Examples

```json
{"v":1,"kind":"ds","list":[3,7,9],"links":"double","detail":true,"ops":["delete 7"]}
```

```json
{"v":1,"kind":"ds","queue":[1,2,3],"capacity":5,"ops":["dequeue","dequeue","enqueue 4","enqueue 5","enqueue 6"]}
```

```json
{"v":1,"kind":"ds","hash":[15,11,27,8,12,22],"m":7,"probe":"chain","ops":["find 22"]}
```
