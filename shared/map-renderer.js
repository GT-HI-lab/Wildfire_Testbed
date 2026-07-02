import { AGENT_TYPES, SECTION_KEYS, terrainAt } from "./simulation.js";

const COLORS = {
  grass: "#6b8f47",
  brush: "#54733c",
  forest: "#385f35",
  dense: "#24462e",
  grid: "rgba(255,255,255,.08)",
  fire: "#f15b2a",
  ember: "#f6c343",
  water: "#2f80ed",
  detected: "#f2c94c",
  extinguished: "#d5e8d4"
};

export function renderMap(canvas, state, options = {}) {
  if (!canvas || !state) return;
  const ctx = canvas.getContext("2d");
  const dpr = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  canvas.width = Math.max(1, Math.floor(rect.width * dpr));
  canvas.height = Math.max(1, Math.floor(rect.height * dpr));
  ctx.scale(dpr, dpr);

  const size = state.mapSize;
  const cell = Math.min(rect.width, rect.height) / size;
  const ox = (rect.width - cell * size) / 2;
  const oy = options.alignTop ? 0 : (rect.height - cell * size) / 2;
  const visibleCells = options.fogOfWar ? new Set(state.clientKnowledge?.discoveredCells || []) : null;

  ctx.fillStyle = "#102319";
  ctx.fillRect(0, 0, rect.width, rect.height);

  const stride = options.compact ? 4 : 2;
  for (let x = 0; x < size; x += stride) {
    for (let y = 0; y < size; y += stride) {
      ctx.fillStyle = visibleCells && !blockVisible(visibleCells, x, y, stride) ? "#030604" : COLORS[terrainAt(x, y)];
      ctx.fillRect(ox + x * cell, oy + y * cell, Math.ceil(cell * stride), Math.ceil(cell * stride));
    }
  }

  if (!options.compact) {
    ctx.strokeStyle = COLORS.grid;
    ctx.lineWidth = 1;
    for (let i = 0; i <= size; i += 10) {
      ctx.beginPath();
      ctx.moveTo(ox + i * cell, oy);
      ctx.lineTo(ox + i * cell, oy + size * cell);
      ctx.moveTo(ox, oy + i * cell);
      ctx.lineTo(ox + size * cell, oy + i * cell);
      ctx.stroke();
    }
    drawQuadrants(ctx, size, cell, ox, oy, state);
  }

  for (const point of visiblePoints(state.extinguished || [], visibleCells)) {
    drawPoint(ctx, point, cell, ox, oy, COLORS.extinguished, 1.8);
  }

  for (const water of visiblePoints(state.waterSources || [], visibleCells)) {
    drawPoint(ctx, water, cell, ox, oy, COLORS.water, 2.4);
  }

  for (const detection of visiblePoints(state.detected || [], visibleCells)) {
    drawRing(ctx, detection, cell, ox, oy, COLORS.detected, detection.confidence < 0.7);
  }

  for (const fire of visiblePoints(state.fires || [], visibleCells)) {
    drawPoint(ctx, fire, cell, ox, oy, fire.intensity > 2 ? COLORS.fire : COLORS.ember, 1.5 + fire.intensity * 0.7);
  }

  for (const civilian of visiblePoints(state.civilians || [], visibleCells)) {
    if (!civilian.rescued) drawLabelPoint(ctx, civilian, cell, ox, oy, "#ffffff", "C");
  }

  for (const agent of Object.values(state.agents || {})) {
    if (pointVisible(visibleCells, agent)) drawAgent(ctx, agent, cell, ox, oy);
  }

  if (options.viewport && state.agents?.firefighter) {
    drawVision(ctx, state.agents.firefighter, cell, ox, oy, "#f2c94c", 12);
  }
}

function drawQuadrants(ctx, size, cell, ox, oy, state) {
  const half = size / 2;
  ctx.save();
  ctx.strokeStyle = "rgba(255,248,231,.62)";
  ctx.lineWidth = 2;
  ctx.setLineDash([8, 6]);
  ctx.beginPath();
  ctx.moveTo(ox + half * cell, oy);
  ctx.lineTo(ox + half * cell, oy + size * cell);
  ctx.moveTo(ox, oy + half * cell);
  ctx.lineTo(ox + size * cell, oy + half * cell);
  ctx.stroke();
  ctx.setLineDash([]);

  const labels = {
    NW: { x: 8, y: 10 },
    NE: { x: half + 8, y: 10 },
    SW: { x: 8, y: half + 10 },
    SE: { x: half + 8, y: half + 10 }
  };
  ctx.font = "800 13px system-ui, sans-serif";
  ctx.textAlign = "left";
  ctx.textBaseline = "top";
  for (const key of SECTION_KEYS) {
    const completed = state.experiment?.sections?.[key]?.completed;
    ctx.fillStyle = completed ? "rgba(155,226,158,.95)" : "rgba(255,248,231,.92)";
    ctx.fillText(key, ox + labels[key].x * cell, oy + labels[key].y * cell);
  }
  ctx.restore();
}

export function renderMiniMap(canvas, state) {
  renderMap(canvas, state, { compact: true, viewport: true, fogOfWar: true });
}

export function renderFirstPerson(canvas, state) {
  if (!canvas || !state) return;
  const ctx = canvas.getContext("2d");
  const dpr = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  canvas.width = Math.max(1, Math.floor(rect.width * dpr));
  canvas.height = Math.max(1, Math.floor(rect.height * dpr));
  ctx.scale(dpr, dpr);

  const ff = state.agents.firefighter;
  const grd = ctx.createLinearGradient(0, 0, 0, rect.height);
  grd.addColorStop(0, "#7896a2");
  grd.addColorStop(0.46, "#d6c27a");
  grd.addColorStop(0.47, "#315b37");
  grd.addColorStop(1, "#17261d");
  ctx.fillStyle = grd;
  ctx.fillRect(0, 0, rect.width, rect.height);

  const visibleFires = (state.fires || [])
    .map((fire) => ({ ...fire, d: Math.hypot(fire.x - ff.x, fire.y - ff.y) }))
    .filter((fire) => fire.d < 52)
    .sort((a, b) => b.d - a.d);

  for (const fire of visibleFires) {
    const bearing = Math.atan2(fire.y - ff.y, fire.x - ff.x) - ff.heading;
    const x = rect.width / 2 + Math.sin(bearing) * rect.width * 0.45;
    const h = Math.max(20, 180 - fire.d * 2.4);
    const y = rect.height * 0.65 - h * 0.5;
    ctx.fillStyle = "rgba(241,91,42,.82)";
    ctx.beginPath();
    ctx.ellipse(x, y + h * 0.5, h * 0.18, h * 0.5, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "rgba(40,40,40,.22)";
    ctx.fillRect(x - h * 0.1, 0, h * 0.2, y + h * 0.25);
  }

  drawHorizonAgent(ctx, state.agents.drone, ff, rect, "#56ccf2", "DR");
  if (state.agents.bulldozer) drawHorizonAgent(ctx, state.agents.bulldozer, ff, rect, "#b9864b", "B");
  drawHorizonAgent(ctx, state.agents.helicopter, ff, rect, "#eb5757", "H");

  ctx.fillStyle = "rgba(9,16,13,.68)";
  ctx.fillRect(18, rect.height - 70, 260, 48);
  ctx.fillStyle = "#fff8e7";
  ctx.font = "14px system-ui, sans-serif";
  ctx.fillText(`Position (${ff.x}, ${ff.y})`, 34, rect.height - 44);
  ctx.fillText(`Water ${ff.water}/4`, 34, rect.height - 24);
}

function drawPoint(ctx, point, cell, ox, oy, color, radius) {
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(ox + point.x * cell, oy + point.y * cell, Math.max(1.4, radius * cell), 0, Math.PI * 2);
  ctx.fill();
}

function drawRing(ctx, point, cell, ox, oy, color, dashed) {
  ctx.strokeStyle = color;
  ctx.lineWidth = 1;
  ctx.setLineDash(dashed ? [4, 4] : []);
  ctx.beginPath();
  ctx.arc(ox + point.x * cell, oy + point.y * cell, Math.max(3, 3.8 * cell), 0, Math.PI * 2);
  ctx.stroke();
  ctx.setLineDash([]);
}

function drawLabelPoint(ctx, point, cell, ox, oy, color, label) {
  drawPoint(ctx, point, cell, ox, oy, color, 3.2);
  ctx.fillStyle = "#17261d";
  ctx.font = "700 9px system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(label, ox + point.x * cell, oy + point.y * cell);
}

function drawAgent(ctx, agent, cell, ox, oy) {
  const meta = AGENT_TYPES[agent.type];
  const x = ox + agent.x * cell;
  const y = oy + agent.y * cell;
  ctx.fillStyle = meta.color;
  ctx.strokeStyle = "#101614";
  ctx.lineWidth = 1.25;
  ctx.beginPath();
  ctx.arc(x, y, Math.max(3.4, 3.3 * cell), 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = "#101614";
  ctx.font = "700 8.5px system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  const label = agent.type === "firefighter" ? "F" : agent.type === "drone" ? "D" : agent.type === "bulldozer" ? "B" : "H";
  ctx.fillText(label, x, y);
}

function drawVision(ctx, agent, cell, ox, oy, color, range) {
  ctx.strokeStyle = color;
  ctx.lineWidth = 1;
  ctx.globalAlpha = 0.45;
  ctx.beginPath();
  ctx.arc(ox + agent.x * cell, oy + agent.y * cell, range * cell, 0, Math.PI * 2);
  ctx.stroke();
  ctx.globalAlpha = 1;
}

function visiblePoints(points, visibleCells) {
  if (!visibleCells) return points;
  return points.filter((point) => pointVisible(visibleCells, point));
}

function pointVisible(visibleCells, point) {
  if (!visibleCells || !point) return true;
  const x = Math.round(point.x);
  const y = Math.round(point.y);
  for (let dx = -1; dx <= 1; dx += 1) {
    for (let dy = -1; dy <= 1; dy += 1) {
      if (visibleCells.has(`${x + dx},${y + dy}`)) return true;
    }
  }
  return false;
}

function blockVisible(visibleCells, x, y, stride) {
  for (let sx = x; sx < x + stride; sx += 1) {
    for (let sy = y; sy < y + stride; sy += 1) {
      if (visibleCells.has(`${sx},${sy}`)) return true;
    }
  }
  return false;
}

function drawHorizonAgent(ctx, agent, observer, rect, color, label) {
  const d = Math.hypot(agent.x - observer.x, agent.y - observer.y);
  if (d > 75) return;
  const bearing = Math.atan2(agent.y - observer.y, agent.x - observer.x) - observer.heading;
  const x = rect.width / 2 + Math.sin(bearing) * rect.width * 0.42;
  const y = agent.type === "helicopter" || label === "DR" ? rect.height * 0.25 : rect.height * 0.58;
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(x, y, label === "H" ? 14 : 9, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#0f1715";
  ctx.font = "700 11px system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(label, x, y);
}
