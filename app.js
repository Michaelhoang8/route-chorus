import { example, loopExample, validate } from "./core.js";
const $ = (id) => document.getElementById(id),
  NS = "http://www.w3.org/2000/svg",
  worker = new Worker("/worker.js", { type: "module" });
let model = example(),
  result,
  method = 0,
  round = 1,
  origin = "A",
  sequence = 0,
  ready = false,
  timer = null;
function el(tag, text) {
  const e = document.createElement(tag);
  e.textContent = text;
  return e;
}
function svg(tag, attrs, text) {
  const e = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  if (text !== undefined) e.textContent = text;
  return e;
}
function message(text, error = false) {
  $("message").textContent = text;
  $("message").classList.toggle("error", error);
}
function stop() {
  clearInterval(timer);
  timer = null;
  $("play").textContent = "Play";
}
function compute() {
  stop();
  ready = false;
  $("evidence").disabled = $("csv").disabled = true;
  worker.postMessage({ id: ++sequence, model });
  $("editor").value = JSON.stringify(model, null, 2);
  message("Converging the original topology and replaying the failure…");
}
function change(next) {
  try {
    model = validate(next);
    round = 1;
    if (!model.nodes.includes(origin)) origin = model.nodes[0];
    compute();
  } catch (error) {
    message(error.message, true);
  }
}
let drawnFrame, drawnTimelineResult, drawnOrigin;
function network(frame) {
  if (drawnFrame === frame) {
    for (const n of $("network").querySelectorAll(".node")) {
      n.classList.toggle("selected", n.dataset.router === origin);
      n.setAttribute("aria-pressed", String(n.dataset.router === origin));
    }
    return;
  }
  drawnFrame = frame;
  const s = $("network"),
    coords = Object.fromEntries(
      model.nodes.map((n, i) => {
        const a = -Math.PI / 2 + (i * 2 * Math.PI) / model.nodes.length;
        return [n, [350 + 235 * Math.cos(a), 220 + 155 * Math.sin(a)]];
      }),
    );
  s.replaceChildren();
  const defs = svg("defs", {}),
    marker = svg("marker", {
      id: "arrow",
      viewBox: "0 0 10 10",
      refX: 9,
      refY: 5,
      markerWidth: 7,
      markerHeight: 7,
      orient: "auto",
    });
  marker.append(svg("path", { d: "M0 0 L10 5 L0 10Z", fill: "#446c96" }));
  defs.append(marker);
  s.append(defs);
  for (const e of model.edges) {
    const a = coords[e.a],
      b = coords[e.b],
      failed = e.id === model.failed;
    s.append(
      svg("line", {
        x1: a[0],
        y1: a[1],
        x2: b[0],
        y2: b[1],
        stroke: failed ? "#bc7069" : "#c8d4e1",
        "stroke-width": 2,
        "stroke-dasharray": failed ? "7 6" : "none",
      }),
      svg(
        "text",
        { x: (a[0] + b[0]) / 2 + 8, y: (a[1] + b[1]) / 2 - 8 },
        `${e.id} · ${e.cost}${failed ? " ×" : ""}`,
      ),
    );
  }
  for (const r of frame.routes) {
    if (!r.next) continue;
    const edge = model.edges.find(
      (e) =>
        e.id !== model.failed &&
        ((e.a === r.node && e.b === r.next) ||
          (e.b === r.node && e.a === r.next)),
    );
    if (!edge) continue;
    const a = coords[r.node],
      b = coords[r.next],
      dx = b[0] - a[0],
      dy = b[1] - a[1],
      len = Math.hypot(dx, dy),
      ox = (-dy / len) * 6,
      oy = (dx / len) * 6;
    s.append(
      svg("line", {
        x1: a[0] + (dx / len) * 33 + ox,
        y1: a[1] + (dy / len) * 33 + oy,
        x2: b[0] - (dx / len) * 36 + ox,
        y2: b[1] - (dy / len) * 36 + oy,
        class: "forwarding-arrow",
        stroke: "#446c96",
        "stroke-width": 2,
        "marker-end": "url(#arrow)",
      }),
    );
  }
  for (const r of frame.routes) {
    const [x, y] = coords[r.node],
      g = svg("g", {
        class:
          "node" +
          (r.node === origin ? " selected" : "") +
          (r.metric === 16 ? " unreachable" : "") +
          (r.node === model.destination ? " destination" : ""),
        "data-router": r.node,
        "aria-pressed": String(r.node === origin),
        role: "button",
        tabindex: 0,
        "aria-label": `Router ${r.node}, metric ${r.metric}${r.node === model.destination ? ", destination" : ""}`,
      });
    g.append(
      svg("circle", { cx: x, cy: y, r: 31 }),
      svg("text", { x, y: y - 2, "text-anchor": "middle" }, r.node),
      svg(
        "text",
        { x, y: y + 17, "text-anchor": "middle" },
        r.metric === 16 ? "∞" : String(r.metric),
      ),
    );
    const choose = () => {
      origin = r.node;
      render();
    };
    g.onclick = choose;
    g.onkeydown = (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        choose();
      }
    };
    s.append(g);
  }
}
function timeline() {
  const s = $("timeline"),
    max = Math.max(1, ...result.runs.map((r) => r.settledRound)),
    xp = (r) => 55 + (r / max) * 800,
    yp = (m) => 185 - (m / 16) * 155;
  if (drawnTimelineResult === result && drawnOrigin === origin) {
    s.querySelector(".round-cursor").style.transform =
      `translateX(${xp(round)}px)`;
    return;
  }
  drawnTimelineResult = result;
  drawnOrigin = origin;
  s.replaceChildren();
  for (const value of [0, 4, 8, 12, 16])
    s.append(
      svg("line", {
        x1: 55,
        x2: 855,
        y1: yp(value),
        y2: yp(value),
        stroke: "#e2e9f1",
      }),
      svg(
        "text",
        { x: 43, y: yp(value) + 4, "text-anchor": "end" },
        value === 16 ? "∞" : value,
      ),
    );
  for (let r = 0; r <= max; r++)
    if (r === max || r % Math.max(1, Math.ceil(max / 10)) === 0)
      s.append(svg("text", { x: xp(r), y: 210, "text-anchor": "middle" }, r));
  result.runs.forEach((run, i) => {
    const points = Array.from({ length: max + 1 }, (_, r) => {
      const f = run.frames[Math.min(r, run.frames.length - 1)],
        metric = f.routes.find((x) => x.node === origin).metric;
      return `${xp(r)},${yp(metric)}`;
    });
    s.append(
      svg("polyline", {
        points: points.join(" "),
        fill: "none",
        stroke: i ? "#aa7551" : "#446c96",
        "stroke-width": 2.5,
      }),
    );
  });
  s.append(
    svg("line", {
      x1: 0,
      x2: 0,
      class: "round-cursor",
      y1: 22,
      y2: 185,
      stroke: "#8999ad",
      "stroke-dasharray": "4 4",
    }),
  );
  s.querySelector(".round-cursor").style.transform =
    `translateX(${xp(round)}px)`;
}
function render() {
  if (!ready || !result) return;
  const run = result.runs[method];
  round = Math.min(round, run.frames.length - 1);
  const frame = run.frames[round],
    path = frame.forwarding.find((p) => p.node === origin);
  $("round").max = run.frames.length - 1;
  $("round").value = round;
  $("position").textContent = `${round} / ${run.frames.length - 1}`;
  $("back").disabled = round === 0;
  $("next").disabled = round === run.frames.length - 1;
  $("method").value = method;
  $("origin").replaceChildren(
    ...model.nodes.map((n) => {
      const o = el(
        "option",
        n + (n === model.destination ? " · destination" : ""),
      );
      o.value = n;
      return o;
    }),
  );
  $("origin").value = origin;
  $("failed").replaceChildren(
    ...[
      [null, "No failure"],
      ...model.edges.map((e) => [e.id, `${e.id}: ${e.a}–${e.b}`]),
    ].map(([value, label]) => {
      const o = el("option", label);
      o.value = value || "";
      return o;
    }),
  );
  $("failed").value = model.failed || "";
  $("metrics").replaceChildren(
    ...[
      [
        "Ordinary settles",
        result.runs[0].converged
          ? result.runs[0].settledRound + " rounds"
          : "Limit reached",
      ],
      [
        "Poisoned reverse settles",
        result.runs[1].converged
          ? result.runs[1].settledRound + " rounds"
          : "Limit reached",
      ],
      ["Routes changed", frame.changed.length],
      [
        "Looping origins",
        frame.forwarding.filter((p) => p.status === "loop").length,
      ],
    ].map(([label, value]) => {
      const p = el("p", label);
      p.prepend(el("b", String(value)));
      return p;
    }),
  );
  $("path").replaceChildren(
    ...path.path.map((name, i) => {
      const chip = el("span", name);
      chip.className = "hop";
      if (i === path.path.length - 1) chip.classList.add(path.status);
      return chip;
    }),
  );
  $("path-note").textContent =
    path.status === "delivered"
      ? `Delivered to ${model.destination}; actual path cost ${path.cost}.`
      : path.status === "loop"
        ? "Forwarding revisits a router: the packet would loop."
        : path.status === "broken-link"
          ? "The stored next hop crosses the failed link."
          : "No usable next hop remains.";
  $("routes").replaceChildren(
    ...frame.routes.map((r) => {
      const tr = el("tr", "");
      for (const v of [
        r.node,
        r.metric === 16 ? "16 · unreachable" : r.metric,
        r.next || "—",
      ])
        tr.append(el("td", String(v)));
      return tr;
    }),
  );
  $("ads").replaceChildren(
    ...frame.advertisements
      .filter((a) => a.to === origin)
      .map((a) => {
        const tr = el("tr", "");
        for (const v of [
          a.from,
          a.cost,
          a.advertised,
          a.poisoned ? "yes" : "no",
          Math.min(16, a.cost + a.advertised),
        ])
          tr.append(el("td", String(v)));
        return tr;
      }),
  );
  if (!frame.advertisements.length) {
    const tr = el("tr", ""),
      td = el("td", "Round zero precedes the first post-failure exchange.");
    td.colSpan = 5;
    tr.append(td);
    $("ads").append(tr);
  }
  network(frame);
  timeline();
}
worker.onmessage = ({ data }) => {
  if (data.id !== sequence) return;
  if (data.error) {
    message(data.error, true);
    return;
  }
  result = data.result;
  ready = true;
  $("evidence").disabled = $("csv").disabled = false;
  render();
  message(
    result.runs.every((r) => r.converged)
      ? "Both policies settled. Inspect how their intermediate forwarding paths differ."
      : "A policy reached the 64-round limit without settling. Inspect its recorded prefix.",
  );
};
worker.onerror = () =>
  message("Routing worker failed. Reload to restart.", true);
$("method").onchange = () => {
  stop();
  method = Number($("method").value);
  render();
};
$("failed").onchange = () =>
  change({ ...model, failed: $("failed").value || null });
$("origin").onchange = () => {
  origin = $("origin").value;
  render();
};
$("round").oninput = () => {
  if (!ready) return;
  stop();
  round = Number($("round").value);
  render();
};
$("back").onclick = () => {
  if (!ready) return;
  stop();
  round = Math.max(0, round - 1);
  render();
};
$("next").onclick = () => {
  if (!ready) return;
  stop();
  round = Math.min(result.runs[method].frames.length - 1, round + 1);
  render();
};
$("play").onclick = () => {
  if (timer) {
    stop();
    return;
  }
  if (!ready) return;
  const max = result.runs[method].frames.length - 1;
  if (round === max) round = 0;
  $("play").textContent = "Pause";
  render();
  timer = setInterval(() => {
    round++;
    render();
    if (round >= max) stop();
  }, 700);
};
$("example").onclick = () => change(example());
$("loop-example").onclick = () => change(loopExample());
$("apply").onclick = () => {
  try {
    if ($("editor").value.length > 50000)
      throw Error("Topology must be at most 50 KB.");
    change(JSON.parse($("editor").value));
  } catch (error) {
    message(error.message, true);
  }
};
function download(name, data, type = "application/json") {
  const url = URL.createObjectURL(new Blob([data], { type })),
    a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
$("save").onclick = () =>
  download("route-chorus-topology.json", JSON.stringify(model, null, 2) + "\n");
$("evidence").onclick = () => {
  if (ready)
    download(
      "route-chorus-evidence.json",
      JSON.stringify(
        { ...result, inspection: { method, round, origin } },
        null,
        2,
      ) + "\n",
    );
};
$("csv").onclick = () => {
  if (ready)
    download(
      "route-chorus-routes.csv",
      "method,round,node,metric,next,forwarding\n" +
        result.runs
          .flatMap((run) =>
            run.frames.flatMap((f) =>
              f.routes.map((r, i) =>
                [
                  run.method,
                  f.round,
                  r.node,
                  r.metric,
                  r.next || "",
                  f.forwarding[i].status,
                ].join(","),
              ),
            ),
          )
          .join("\n") +
        "\n",
      "text/csv",
    );
};
$("open").onclick = () => $("file").click();
$("file").onchange = async () => {
  const file = $("file").files[0];
  $("file").value = "";
  if (!file) return;
  try {
    if (file.size > 50000) throw Error("Topology must be at most 50 KB.");
    change(JSON.parse(await file.text()));
  } catch (error) {
    message(error.message, true);
  }
};
compute();
