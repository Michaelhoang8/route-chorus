export const INFINITY = 16;
export function validate(model) {
  if (
    !model ||
    Object.keys(model).sort().join(",") !== "destination,edges,failed,nodes" ||
    !Array.isArray(model.nodes) ||
    model.nodes.length < 2 ||
    model.nodes.length > 8 ||
    new Set(model.nodes).size !== model.nodes.length ||
    model.nodes.some(
      (n) => typeof n !== "string" || !/^[A-Z][A-Z0-9]{0,7}$/.test(n),
    ) ||
    !model.nodes.includes(model.destination) ||
    !Array.isArray(model.edges) ||
    model.edges.length > 28
  )
    throw Error(
      "Use 2–8 distinct uppercase node IDs, a destination, and at most 28 links.",
    );
  const ids = new Set(),
    pairs = new Set();
  for (const e of model.edges) {
    if (
      !e ||
      Object.keys(e).sort().join(",") !== "a,b,cost,id" ||
      typeof e.id !== "string" ||
      !/^[A-Za-z][A-Za-z0-9_-]{0,15}$/.test(e.id) ||
      ids.has(e.id) ||
      !model.nodes.includes(e.a) ||
      !model.nodes.includes(e.b) ||
      e.a === e.b ||
      !Number.isInteger(e.cost) ||
      e.cost < 1 ||
      e.cost > 9
    )
      throw Error(
        "Links need unique IDs, distinct existing endpoints, and integer costs 1–9.",
      );
    ids.add(e.id);
    const pair = [e.a, e.b].sort().join(":");
    if (pairs.has(pair)) throw Error("Parallel links are not supported.");
    pairs.add(pair);
  }
  if (model.failed !== null && !ids.has(model.failed))
    throw Error("Failed link must exist, or be null.");
  return structuredClone(model);
}
function same(a, b) {
  return a.every((r, i) => r.metric === b[i].metric && r.next === b[i].next);
}
export function exchange(model, routes, edges, poison) {
  const ads = [];
  for (const e of edges)
    for (const [from, to] of [
      [e.a, e.b],
      [e.b, e.a],
    ]) {
      const r = routes[model.nodes.indexOf(from)],
        poisoned = poison && r.next === to;
      ads.push({
        from,
        to,
        link: e.id,
        cost: e.cost,
        advertised: poisoned ? INFINITY : r.metric,
        poisoned,
      });
    }
  const next = model.nodes.map((node) => {
    if (node === model.destination) return { node, metric: 0, next: null };
    let metric = INFINITY,
      hop = null;
    for (const neighbor of model.nodes) {
      const ad = ads.find((a) => a.from === neighbor && a.to === node);
      if (!ad) continue;
      const candidate = Math.min(INFINITY, ad.cost + ad.advertised);
      if (candidate < metric) {
        metric = candidate;
        hop = neighbor;
      }
    }
    return { node, metric, next: hop };
  });
  return { routes: next, advertisements: ads };
}
export function forwarding(model, routes, edges, start) {
  const path = [start];
  let current = start,
    cost = 0;
  while (true) {
    if (current === model.destination)
      return { status: "delivered", path, cost };
    const r = routes[model.nodes.indexOf(current)];
    if (r.metric === INFINITY || r.next === null)
      return { status: "unreachable", path, cost };
    const edge = edges.find(
      (e) =>
        (e.a === current && e.b === r.next) ||
        (e.b === current && e.a === r.next),
    );
    if (!edge) return { status: "broken-link", path: [...path, r.next], cost };
    cost += edge.cost;
    current = r.next;
    path.push(current);
    if (path.slice(0, -1).includes(current))
      return { status: "loop", path, cost };
  }
}
function run(model, poison) {
  let routes = model.nodes.map((node) => ({
      node,
      metric: node === model.destination ? 0 : INFINITY,
      next: null,
    })),
    warmup = 0;
  for (; warmup < 64; warmup++) {
    const next = exchange(model, routes, model.edges, poison).routes;
    if (same(next, routes)) break;
    routes = next;
  }
  if (warmup === 64) throw Error("Initial topology did not settle.");
  const active = model.edges.filter((e) => e.id !== model.failed),
    frames = [];
  function frame(round, advertisements, changed) {
    return {
      round,
      routes: structuredClone(routes),
      advertisements,
      changed,
      forwarding: model.nodes.map((n) => ({
        node: n,
        ...forwarding(model, routes, active, n),
      })),
    };
  }
  frames.push(frame(0, [], []));
  let converged = false;
  for (let round = 1; round <= 64; round++) {
    const next = exchange(model, routes, active, poison),
      changed = routes
        .filter(
          (r, i) =>
            r.metric !== next.routes[i].metric ||
            r.next !== next.routes[i].next,
        )
        .map((r) => r.node),
      stable = same(routes, next.routes);
    routes = next.routes;
    frames.push(frame(round, next.advertisements, changed));
    if (stable) {
      converged = true;
      break;
    }
  }
  return {
    method: poison ? "poisoned-reverse" : "ordinary",
    warmupRounds: warmup,
    frames,
    converged,
    settledRound: frames.at(-1).round,
  };
}
export function analyze(input) {
  const model = validate(input);
  return {
    format: "route-chorus-evidence-v1",
    model,
    infinity: INFINITY,
    runs: [run(model, false), run(model, true)],
  };
}
export function example() {
  return {
    nodes: ["A", "B", "C"],
    destination: "C",
    edges: [
      { id: "AB", a: "A", b: "B", cost: 1 },
      { id: "BC", a: "B", b: "C", cost: 1 },
    ],
    failed: "BC",
  };
}
export function loopExample() {
  return {
    nodes: ["A", "B", "C", "D", "E"],
    destination: "E",
    edges: [
      { id: "AB", a: "A", b: "B", cost: 1 },
      { id: "AD", a: "A", b: "D", cost: 2 },
      { id: "BC", a: "B", b: "C", cost: 2 },
      { id: "BD", a: "B", b: "D", cost: 3 },
      { id: "CD", a: "C", b: "D", cost: 2 },
      { id: "DE", a: "D", b: "E", cost: 2 },
    ],
    failed: "DE",
  };
}
