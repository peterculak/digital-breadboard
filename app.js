const workspace = document.querySelector("#workspace");
const wiresLayer = document.querySelector("#wires");
const tickSpeed = document.querySelector("#tickSpeed");
const tickOutput = document.querySelector("#tickOutput");
const tickLight = document.querySelector("#tickLight");
const resetCircuit = document.querySelector("#resetCircuit");
const loadStarter = document.querySelector("#loadStarter");
const clearWires = document.querySelector("#clearWires");

const state = {
  parts: [],
  wires: [],
  nextPartId: 1,
  selectedTerminal: null,
  draftingPoints: [],
  pointer: null,
  tickMs: 500,
  tickTimer: null,
};

const partConfig = {
  battery: {
    label: "Battery",
    terminals: [
      { id: "positive", label: "+", side: "right", rail: "positive" },
      { id: "negative", label: "-", side: "left", rail: "negative" },
    ],
    createState: () => ({}),
  },
  switch: {
    label: "Switch",
    terminals: [
      { id: "a", label: "A", side: "left" },
      { id: "b", label: "B", side: "right" },
    ],
    createState: () => ({ closed: false }),
  },
  bulb: {
    label: "Bulb",
    terminals: [
      { id: "a", label: "A", side: "left" },
      { id: "b", label: "B", side: "right" },
    ],
    createState: () => ({ lit: false }),
  },
};

function createPart(type, x, y) {
  const config = partConfig[type];
  const part = {
    id: `part-${state.nextPartId++}`,
    type,
    x,
    y,
    terminalPower: {},
    data: config.createState(),
  };

  const element = document.createElement("article");
  element.className = `part ${type}-part`;
  element.dataset.partId = part.id;
  element.innerHTML = `
    <div class="part-header">
      <span>${config.label}</span>
      <span>${type.toUpperCase()}</span>
    </div>
    <div class="part-body"></div>
  `;

  renderPartBody(part, element.querySelector(".part-body"));
  addTerminals(part, element, config);
  workspace.append(element);

  part.element = element;
  state.parts.push(part);
  movePart(part, x, y);
  attachDrag(part);
  evaluateCircuit();
  return part;
}

function renderPartBody(part, body) {
  if (part.type === "battery") {
    body.innerHTML = `
      <div class="battery-view">
        <div class="battery-cap positive">+</div>
        <div class="battery-cell"></div>
        <div class="battery-cap negative">-</div>
      </div>
    `;
    return;
  }

  if (part.type === "switch") {
    const control = document.createElement("button");
    control.className = "knife-switch";
    control.type = "button";
    control.ariaLabel = "Toggle switch";
    control.innerHTML = `
      <span class="switch-post"></span>
      <span class="switch-blade"></span>
      <span class="switch-post"></span>
    `;
    control.addEventListener("click", (event) => {
      event.stopPropagation();
      part.data.closed = !part.data.closed;
      evaluateCircuit();
    });
    body.append(control);
    return;
  }

  const bulb = document.createElement("div");
  bulb.className = "bulb-view";
  bulb.setAttribute("role", "img");
  bulb.setAttribute("aria-label", "Bulb");
  body.append(bulb);
}

function addTerminals(part, element, config) {
  config.terminals.forEach((terminal, index) => {
    const pin = document.createElement("button");
    pin.type = "button";
    pin.className = `terminal ${terminal.side}`;
    pin.textContent = terminal.label;
    pin.dataset.partId = part.id;
    pin.dataset.terminalId = terminal.id;
    pin.style.top = `${config.terminals.length === 1 ? 52 : 42 + index * 22}%`;
    pin.ariaLabel = `${config.label} ${terminal.label} terminal`;
    pin.addEventListener("click", (event) => handleTerminalClick(event, part, terminal.id));
    element.append(pin);
  });
}

function handleTerminalClick(event, part, terminalId) {
  event.stopPropagation();

  const terminal = { partId: part.id, terminalId };
  if (!state.selectedTerminal) {
    state.selectedTerminal = terminal;
    event.currentTarget.classList.add("selected");
    return;
  }

  if (
    state.selectedTerminal.partId === terminal.partId &&
    state.selectedTerminal.terminalId === terminal.terminalId
  ) {
    clearSelectedTerminal();
    return;
  }

  state.wires.push({
    from: state.selectedTerminal,
    to: terminal,
    energized: false,
    points: [...state.draftingPoints],
  });
  clearSelectedTerminal();
  evaluateCircuit();
}

function clearSelectedTerminal() {
  workspace.querySelectorAll(".terminal.selected").forEach((pin) => {
    pin.classList.remove("selected");
  });
  state.selectedTerminal = null;
  state.draftingPoints = [];
  state.pointer = null;
  drawWires();
}

function attachDrag(part) {
  const header = part.element.querySelector(".part-header");
  header.addEventListener("pointerdown", (event) => {
    const start = {
      pointerX: event.clientX,
      pointerY: event.clientY,
      partX: part.x,
      partY: part.y,
    };
    part.element.classList.add("dragging");
    header.setPointerCapture(event.pointerId);

    const onMove = (moveEvent) => {
      movePart(
        part,
        start.partX + moveEvent.clientX - start.pointerX,
        start.partY + moveEvent.clientY - start.pointerY,
      );
      drawWires();
    };

    const onUp = () => {
      part.element.classList.remove("dragging");
      header.removeEventListener("pointermove", onMove);
      header.removeEventListener("pointerup", onUp);
      header.removeEventListener("pointercancel", onUp);
    };

    header.addEventListener("pointermove", onMove);
    header.addEventListener("pointerup", onUp);
    header.addEventListener("pointercancel", onUp);
  });
}

function movePart(part, x, y) {
  const bounds = workspace.getBoundingClientRect();
  const maxX = Math.max(0, bounds.width - 164);
  const maxY = Math.max(0, bounds.height - 128);
  part.x = Math.min(Math.max(12, x), maxX);
  part.y = Math.min(Math.max(12, y), maxY);
  part.element.style.transform = `translate(${part.x}px, ${part.y}px)`;
}

function evaluateCircuit() {
  const graph = buildGraph();
  const positiveRoots = [];
  const negativeRoots = [];

  for (const part of state.parts) {
    part.terminalPower = {};
    if (part.type !== "battery") continue;
    positiveRoots.push(terminalKey(part.id, "positive"));
    negativeRoots.push(terminalKey(part.id, "negative"));
  }

  const positiveSet = flood(graph, positiveRoots);
  const negativeSet = flood(graph, negativeRoots);

  for (const part of state.parts) {
    for (const terminal of partConfig[part.type].terminals) {
      const key = terminalKey(part.id, terminal.id);
      part.terminalPower[terminal.id] = {
        positive: positiveSet.has(key),
        negative: negativeSet.has(key),
      };
    }

    if (part.type === "bulb") {
      const a = part.terminalPower.a;
      const b = part.terminalPower.b;
      part.data.lit = Boolean(
        (a.positive && b.negative) ||
          (a.negative && b.positive),
      );
    }
  }

  for (const wire of state.wires) {
    const from = terminalState(wire.from);
    const to = terminalState(wire.to);
    wire.polarity = inferWirePolarity(from, to);
    wire.energized = Boolean(
      (from.positive || to.positive || from.negative || to.negative) &&
        state.parts.some((part) => part.type === "bulb" && part.data.lit),
    );
  }

  renderState();
  drawWires();
}

function buildGraph() {
  const graph = new Map();
  for (const part of state.parts) {
    for (const terminal of partConfig[part.type].terminals) {
      ensureGraphNode(graph, terminalKey(part.id, terminal.id));
    }
  }

  for (const wire of state.wires) {
    connect(graph, keyFromTerminal(wire.from), keyFromTerminal(wire.to));
  }

  for (const part of state.parts) {
    if (part.type === "switch" && part.data.closed) {
      connect(graph, terminalKey(part.id, "a"), terminalKey(part.id, "b"));
    }
  }

  return graph;
}

function flood(graph, roots) {
  const visited = new Set();
  const stack = [...roots];

  while (stack.length > 0) {
    const key = stack.pop();
    if (visited.has(key)) continue;
    visited.add(key);
    for (const next of graph.get(key) ?? []) {
      stack.push(next);
    }
  }

  return visited;
}

function ensureGraphNode(graph, key) {
  if (!graph.has(key)) graph.set(key, new Set());
}

function connect(graph, a, b) {
  ensureGraphNode(graph, a);
  ensureGraphNode(graph, b);
  graph.get(a).add(b);
  graph.get(b).add(a);
}

function terminalKey(partId, terminalId) {
  return `${partId}:${terminalId}`;
}

function keyFromTerminal(terminal) {
  return terminalKey(terminal.partId, terminal.terminalId);
}

function terminalState(terminal) {
  const part = findPart(terminal.partId);
  return part?.terminalPower[terminal.terminalId] ?? { positive: false, negative: false };
}

function renderState() {
  for (const part of state.parts) {
    part.element.classList.toggle("is-closed", Boolean(part.data.closed));
    part.element.classList.toggle("is-lit", Boolean(part.data.lit));

    part.element.querySelectorAll(".terminal").forEach((pin) => {
      const power = part.terminalPower[pin.dataset.terminalId] ?? {};
      pin.classList.toggle("is-positive", Boolean(power.positive));
      pin.classList.toggle("is-negative", Boolean(power.negative));
    });

    const switchControl = part.element.querySelector(".knife-switch");
    if (switchControl) {
      switchControl.classList.toggle("is-closed", part.data.closed);
    }

    const bulb = part.element.querySelector(".bulb-view");
    if (bulb) {
      bulb.classList.toggle("is-on", part.data.lit);
    }
  }
}

function drawWires() {
  wiresLayer.innerHTML = "";

  for (const [index, wire] of state.wires.entries()) {
    const fromPin = getTerminalElement(wire.from.partId, wire.from.terminalId);
    const toPin = getTerminalElement(wire.to.partId, wire.to.terminalId);
    if (!fromPin || !toPin) continue;

    const from = terminalCenter(fromPin);
    const to = terminalCenter(toPin);
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute("d", buildWirePath(from, wire.points ?? [], to));
    const polarityClass = wire.polarity ? ` polarity-${wire.polarity}` : "";
    path.setAttribute("class", `wire${wire.energized ? " is-on" : ""}${polarityClass}`);
    path.dataset.wireIndex = String(index);
    path.addEventListener("click", (event) => {
      event.stopPropagation();
      removeWireAtIndex(index);
    });
    wiresLayer.append(path);
  }

  if (state.selectedTerminal) {
    const fromPin = getTerminalElement(
      state.selectedTerminal.partId,
      state.selectedTerminal.terminalId,
    );
    if (!fromPin) return;
    const from = terminalCenter(fromPin);
    const previewPoints = [...state.draftingPoints];
    if (state.pointer) previewPoints.push(state.pointer);
    const preview = document.createElementNS("http://www.w3.org/2000/svg", "path");
    preview.setAttribute("d", buildWirePath(from, previewPoints, previewPoints.at(-1) ?? from));
    preview.setAttribute("class", "wire wire-preview");
    wiresLayer.append(preview);
  }
}

function buildWirePath(from, points, to) {
  const pathPoints = [from, ...points, to];
  if (pathPoints.length < 2) return `M ${from.x} ${from.y}`;
  return pathPoints
    .map((point, index) =>
      `${index === 0 ? "M" : "L"} ${Math.round(point.x)} ${Math.round(point.y)}`,
    )
    .join(" ");
}

function inferWirePolarity(from, to) {
  if ((from.positive && !from.negative) || (to.positive && !to.negative)) return "positive";
  if ((from.negative && !from.positive) || (to.negative && !to.positive)) return "negative";
  return "";
}

function terminalCenter(pin) {
  const workspaceRect = workspace.getBoundingClientRect();
  const pinRect = pin.getBoundingClientRect();
  return {
    x: pinRect.left - workspaceRect.left + pinRect.width / 2,
    y: pinRect.top - workspaceRect.top + pinRect.height / 2,
  };
}

function getTerminalElement(partId, terminalId) {
  return workspace.querySelector(
    `.terminal[data-part-id="${partId}"][data-terminal-id="${terminalId}"]`,
  );
}

function findPart(partId) {
  return state.parts.find((part) => part.id === partId);
}

function clearBoard() {
  state.parts.forEach((part) => part.element.remove());
  state.parts = [];
  state.wires = [];
  state.nextPartId = 1;
  clearSelectedTerminal();
  evaluateCircuit();
}

function loadStarterLoop() {
  clearBoard();

  const bounds = workspace.getBoundingClientRect();
  const compact = bounds.width < 760;
  const battery = createPart("battery", compact ? 34 : 92, compact ? 150 : 190);
  const switchPart = createPart("switch", compact ? 230 : 330, compact ? 90 : 106);
  const bulb = createPart("bulb", compact ? 230 : 574, compact ? 245 : 190);

  state.wires.push(
    {
      from: { partId: battery.id, terminalId: "positive" },
      to: { partId: switchPart.id, terminalId: "a" },
      energized: false,
    },
    {
      from: { partId: switchPart.id, terminalId: "b" },
      to: { partId: bulb.id, terminalId: "a" },
      energized: false,
    },
    {
      from: { partId: bulb.id, terminalId: "b" },
      to: { partId: battery.id, terminalId: "negative" },
      energized: false,
    },
  );

  evaluateCircuit();
}

function removeWireAtIndex(index) {
  if (index < 0 || index >= state.wires.length) return;
  state.wires.splice(index, 1);
  evaluateCircuit();
}

function clearAllWires() {
  state.wires = [];
  clearSelectedTerminal();
  evaluateCircuit();
}

function setTickSpeed() {
  const hertz = Number(tickSpeed.value);
  state.tickMs = Math.round(1000 / hertz);
  tickOutput.value = `${hertz} Hz`;
  window.clearInterval(state.tickTimer);
  state.tickTimer = window.setInterval(() => {
    tickLight.classList.add("is-ticking");
    window.setTimeout(() => tickLight.classList.remove("is-ticking"), 90);
    evaluateCircuit();
  }, state.tickMs);
}

document.querySelectorAll(".palette-item").forEach((item) => {
  item.addEventListener("click", () => {
    const type = item.dataset.type;
    const offset = 36 * (state.parts.length % 5);
    createPart(type, 120 + offset, 80 + offset);
  });

  item.addEventListener("dragstart", (event) => {
    event.dataTransfer.setData("text/plain", item.dataset.type);
    event.dataTransfer.effectAllowed = "copy";
  });
});

workspace.addEventListener("dragover", (event) => {
  if (!Array.from(event.dataTransfer.types).includes("text/plain")) return;
  event.preventDefault();
  event.dataTransfer.dropEffect = "copy";
  workspace.classList.add("is-drop-target");
});

workspace.addEventListener("dragleave", (event) => {
  if (!workspace.contains(event.relatedTarget)) {
    workspace.classList.remove("is-drop-target");
  }
});

workspace.addEventListener("drop", (event) => {
  const type = event.dataTransfer.getData("text/plain");
  if (!partConfig[type]) return;
  event.preventDefault();
  workspace.classList.remove("is-drop-target");
  const bounds = workspace.getBoundingClientRect();
  createPart(type, event.clientX - bounds.left - 72, event.clientY - bounds.top - 50);
});

workspace.addEventListener("pointerdown", (event) => {
  if (event.target.classList.contains("terminal")) return;

  if (state.selectedTerminal) {
    const bounds = workspace.getBoundingClientRect();
    state.draftingPoints.push({
      x: event.clientX - bounds.left,
      y: event.clientY - bounds.top,
    });
    drawWires();
    return;
  }

  if (event.target === workspace || event.target.classList.contains("grid")) {
    clearSelectedTerminal();
  }
});

workspace.addEventListener("pointermove", (event) => {
  if (!state.selectedTerminal) return;
  const bounds = workspace.getBoundingClientRect();
  state.pointer = {
    x: event.clientX - bounds.left,
    y: event.clientY - bounds.top,
  };
  drawWires();
});

workspace.addEventListener("pointerleave", () => {
  if (!state.selectedTerminal) return;
  state.pointer = null;
  drawWires();
});

window.addEventListener("resize", drawWires);
tickSpeed.addEventListener("input", setTickSpeed);
resetCircuit.addEventListener("click", clearBoard);
loadStarter.addEventListener("click", loadStarterLoop);
clearWires.addEventListener("click", clearAllWires);

loadStarterLoop();
setTickSpeed();
