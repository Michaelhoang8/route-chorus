import test from "node:test";
import assert from "node:assert/strict";
import {
  analyze,
  example,
  loopExample,
  exchange,
  forwarding,
  validate,
} from "../core.js";
test("poisoned reverse still admits a three-router transient loop", () => {
  const r = analyze(loopExample()).runs[1];
  assert.deepEqual(r.frames[1].forwarding[0].path, ["A", "D", "B", "A"]);
  assert.equal(r.frames[1].forwarding[0].status, "loop");
  assert.equal(r.converged, true);
});
test("line failure counts to infinity without poison and clears quickly with poison", () => {
  const e = analyze(example()),
    [plain, poison] = e.runs;
  assert.equal(plain.frames[1].routes[1].metric, 3);
  assert.equal(plain.frames[1].forwarding[0].status, "loop");
  assert.equal(poison.frames[1].routes[1].metric, 16);
  assert.equal(poison.frames[2].routes[0].metric, 16);
  assert.ok(plain.settledRound > poison.settledRound);
  for (const r of e.runs)
    assert.deepEqual(
      r.frames.at(-1).routes.map((x) => x.metric),
      [16, 16, 0],
    );
});
test("poison is recipient-specific and does not change local stored metric", () => {
  const m = { nodes: ["A", "B", "C"], destination: "C" },
    r = [
      { node: "A", metric: 2, next: "B" },
      { node: "B", metric: 1, next: "C" },
      { node: "C", metric: 0, next: null },
    ],
    edges = [
      { id: "AB", a: "A", b: "B", cost: 1 },
      { id: "AC", a: "A", b: "C", cost: 5 },
    ];
  const x = exchange(m, r, edges, true);
  assert.equal(
    x.advertisements.find((a) => a.from === "A" && a.to === "B").advertised,
    16,
  );
  assert.equal(
    x.advertisements.find((a) => a.from === "A" && a.to === "C").advertised,
    2,
  );
  assert.equal(r[0].metric, 2);
});
test("forwarding distinguishes dead links, loops, delivery and unreachable routes", () => {
  const m = example(),
    r = [
      { node: "A", metric: 2, next: "B" },
      { node: "B", metric: 1, next: "C" },
      { node: "C", metric: 0, next: null },
    ];
  assert.equal(forwarding(m, r, m.edges, "A").cost, 2);
  assert.equal(
    forwarding(m, r, m.edges.slice(0, 1), "A").status,
    "broken-link",
  );
  r[1] = { node: "B", metric: 3, next: "A" };
  assert.deepEqual(forwarding(m, r, m.edges, "A").path, ["A", "B", "A"]);
  r[0] = { node: "A", metric: 16, next: null };
  assert.equal(forwarding(m, r, m.edges, "A").status, "unreachable");
});
test("300 random topologies settle to independent Floyd-Warshall distances after removal", () => {
  let seed = 51;
  const rnd = (n) => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed % n;
  };
  for (let t = 0; t < 300; t++) {
    const n = 2 + rnd(7),
      nodes = Array.from({ length: n }, (_, i) => String.fromCharCode(65 + i)),
      edges = [];
    for (let i = 0; i < n; i++)
      for (let j = i + 1; j < n; j++)
        if (rnd(3))
          edges.push({
            id: "E" + edges.length,
            a: nodes[i],
            b: nodes[j],
            cost: 1 + rnd(9),
          });
    const m = {
        nodes,
        edges,
        destination: nodes[rnd(n)],
        failed: edges.length ? edges[rnd(edges.length)].id : null,
      },
      dist = Array.from({ length: n }, (_, i) =>
        Array.from({ length: n }, (_, j) => (i === j ? 0 : Infinity)),
      );
    for (const e of edges.filter((e) => e.id !== m.failed)) {
      const i = nodes.indexOf(e.a),
        j = nodes.indexOf(e.b);
      dist[i][j] = dist[j][i] = e.cost;
    }
    for (let k = 0; k < n; k++)
      for (let i = 0; i < n; i++)
        for (let j = 0; j < n; j++)
          dist[i][j] = Math.min(dist[i][j], dist[i][k] + dist[k][j]);
    const expected = nodes.map((_, i) =>
      Math.min(16, dist[i][nodes.indexOf(m.destination)]),
    );
    for (const run of analyze(m).runs) {
      assert.equal(run.converged, true);
      assert.deepEqual(
        run.frames.at(-1).routes.map((r) => r.metric),
        expected,
      );
      for (const f of run.frames)
        for (const r of f.routes) {
          assert.ok(r.metric >= 0 && r.metric <= 16);
          assert.equal(
            r.metric === 16,
            r.next === null && r.node !== m.destination,
          );
        }
      for (const f of run.frames.at(-1).forwarding)
        if (f.status === "delivered")
          assert.equal(f.cost, expected[nodes.indexOf(f.node)]);
    }
  }
});
test("cost cap and deterministic tie-breaking are explicit", () => {
  const m = {
    nodes: ["A", "B", "C", "D"],
    destination: "D",
    edges: [
      { id: "AB", a: "A", b: "B", cost: 8 },
      { id: "BD", a: "B", b: "D", cost: 8 },
      { id: "AC", a: "A", b: "C", cost: 8 },
      { id: "CD", a: "C", b: "D", cost: 8 },
    ],
    failed: null,
  };
  assert.equal(analyze(m).runs[0].frames[0].routes[0].metric, 16);
  m.edges.forEach((e) => (e.cost = 1));
  assert.equal(analyze(m).runs[0].frames[0].routes[0].next, "B");
});
test("invalid graphs are rejected", () => {
  assert.throws(() => validate({ ...example(), failed: "missing" }));
  assert.throws(() => validate({ ...example(), nodes: ["A", "A"] }));
  assert.throws(() =>
    validate({
      ...example(),
      edges: [...example().edges, { id: "X", a: "B", b: "A", cost: 1 }],
    }),
  );
  assert.throws(() =>
    validate({ ...example(), edges: [{ id: "X", a: "A", b: "B", cost: 0 }] }),
  );
});
