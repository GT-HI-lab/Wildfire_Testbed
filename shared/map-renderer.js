import { AGENT_TYPES, SECTION_KEYS, terrainAt } from "./simulation.js";

const COLORS = {
  grass: "#789678",
  brush: "#58803d",
  forest: "#176125",
  dense: "#084218",
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
  const horizon = rect.height * 0.43;
  drawSkyAndGround(ctx, rect, horizon, state.tick || 0);

  const scenery = collectScenery(state, ff);
  for (const item of scenery) {
    const projected = projectToView(item, ff, rect, horizon);
    if (!projected) continue;
    if (item.kind === "tree") drawPerspectiveTree(ctx, projected, item.variant);
    if (item.kind === "water") drawPerspectiveWater(ctx, projected);
    if (item.kind === "fire") drawPerspectiveFire(ctx, projected, item.intensity, state.tick || 0);
  }

  drawHorizonAgent(ctx, state.agents.drone, ff, rect, "#56ccf2");
  if (state.agents.bulldozer) drawHorizonAgent(ctx, state.agents.bulldozer, ff, rect, "#b9864b");
  drawHorizonAgent(ctx, state.agents.helicopter, ff, rect, "#eb5757");

  ctx.fillStyle = "rgba(9,16,13,.68)";
  ctx.fillRect(18, rect.height - 92, 274, 70);
  ctx.fillStyle = "#fff8e7";
  ctx.font = "14px system-ui, sans-serif";
  ctx.fillText(`Position (${ff.x}, ${ff.y})`, 34, rect.height - 62);
  ctx.fillText(`Facing ${headingLabel(ff.heading)} | Water ${ff.water}/${ff.waterCapacity}`, 34, rect.height - 42);
  ctx.fillStyle = "#b9c9b6";
  ctx.font = "12px system-ui, sans-serif";
  ctx.fillText(compactLabel(ff.lastAction || "Standing by", 38), 34, rect.height - 26);
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
  drawAgentIcon(ctx, agent.type, x, y, Math.max(6, 4.6 * cell), meta.color);
}

function drawVision(ctx, agent, cell, ox, oy, color, range) {
  const x = ox + agent.x * cell;
  const y = oy + agent.y * cell;
  ctx.strokeStyle = color;
  ctx.lineWidth = 1;
  ctx.globalAlpha = 0.45;
  ctx.beginPath();
  ctx.arc(x, y, range * cell, 0, Math.PI * 2);
  ctx.stroke();
  ctx.globalAlpha = 0.9;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.lineTo(
    x + Math.cos(agent.heading || 0) * range * cell,
    y + Math.sin(agent.heading || 0) * range * cell
  );
  ctx.stroke();
  ctx.globalAlpha = 1;
}

function headingLabel(heading = 0) {
  const directions = ["E", "SE", "S", "SW", "W", "NW", "N", "NE"];
  const normalized = ((heading % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
  return directions[Math.round(normalized / (Math.PI / 4)) % directions.length];
}

function compactLabel(value, maxLength) {
  return value.length <= maxLength ? value : `${value.slice(0, maxLength - 3)}...`;
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

function drawHorizonAgent(ctx, agent, observer, rect, color) {
  const d = Math.hypot(agent.x - observer.x, agent.y - observer.y);
  if (d > 75) return;
  const projected = projectToView({ ...agent, kind: "agent" }, observer, rect, rect.height * 0.43);
  if (!projected) return;
  const airborne = agent.type === "helicopter" || agent.type === "drone";
  const y = airborne ? Math.max(rect.height * 0.18, projected.y - projected.scale * 22) : projected.y - projected.scale * 7;
  drawAgentIcon(ctx, agent.type, projected.x, y, Math.max(8, Math.min(20, projected.scale * 10)), color);
}

function drawAgentIcon(ctx, type, x, y, radius, color) {
  ctx.save();
  ctx.translate(x, y);
  ctx.strokeStyle = "#fff8e7";
  ctx.fillStyle = color;
  ctx.lineWidth = Math.max(1, radius * 0.12);
  ctx.lineCap = "round";
  ctx.lineJoin = "round";

  if (type === "drone") {
    ctx.beginPath();
    ctx.moveTo(-radius * 0.55, -radius * 0.4);
    ctx.lineTo(radius * 0.55, radius * 0.4);
    ctx.moveTo(radius * 0.55, -radius * 0.4);
    ctx.lineTo(-radius * 0.55, radius * 0.4);
    ctx.stroke();
    for (const [dx, dy] of [[-0.6, -0.45], [0.6, -0.45], [-0.6, 0.45], [0.6, 0.45]]) {
      ctx.beginPath();
      ctx.arc(dx * radius, dy * radius, radius * 0.22, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }
    ctx.fillRect(-radius * 0.24, -radius * 0.18, radius * 0.48, radius * 0.36);
  } else if (type === "helicopter") {
    ctx.beginPath();
    ctx.ellipse(-radius * 0.1, 0, radius * 0.58, radius * 0.32, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(radius * 0.38, 0);
    ctx.lineTo(radius * 0.86, -radius * 0.16);
    ctx.lineTo(radius * 0.9, radius * 0.12);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(-radius * 0.85, -radius * 0.45);
    ctx.lineTo(radius * 0.65, -radius * 0.45);
    ctx.moveTo(-radius * 0.1, -radius * 0.45);
    ctx.lineTo(-radius * 0.1, -radius * 0.25);
    ctx.stroke();
  } else if (type === "bulldozer") {
    ctx.fillRect(-radius * 0.55, -radius * 0.35, radius * 0.9, radius * 0.58);
    ctx.strokeRect(-radius * 0.55, -radius * 0.35, radius * 0.9, radius * 0.58);
    ctx.fillRect(-radius * 0.68, radius * 0.2, radius * 1.15, radius * 0.28);
    ctx.strokeRect(-radius * 0.68, radius * 0.2, radius * 1.15, radius * 0.28);
    ctx.beginPath();
    ctx.moveTo(radius * 0.35, -radius * 0.1);
    ctx.lineTo(radius * 0.88, -radius * 0.32);
    ctx.lineTo(radius * 0.88, radius * 0.38);
    ctx.lineTo(radius * 0.35, radius * 0.2);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  } else {
    ctx.beginPath();
    ctx.arc(0, -radius * 0.2, radius * 0.32, Math.PI, 0);
    ctx.lineTo(radius * 0.3, 0);
    ctx.lineTo(-radius * 0.3, 0);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.fillRect(-radius * 0.3, radius * 0.05, radius * 0.6, radius * 0.62);
    ctx.strokeRect(-radius * 0.3, radius * 0.05, radius * 0.6, radius * 0.62);
  }
  ctx.restore();
}

function drawSkyAndGround(ctx, rect, horizon, tick) {
  const sky = ctx.createLinearGradient(0, 0, 0, horizon);
  sky.addColorStop(0, "#7895a2");
  sky.addColorStop(0.72, "#b7aa83");
  sky.addColorStop(1, "#d2b27b");
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, rect.width, horizon);

  ctx.fillStyle = "rgba(65,61,52,.22)";
  for (let i = 0; i < 7; i += 1) {
    const x = ((i * 173 + tick * 0.25) % (rect.width + 220)) - 110;
    ctx.beginPath();
    ctx.ellipse(x, horizon * (0.2 + (i % 3) * 0.12), 90 + i * 7, 24 + i * 4, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  const dirt = ctx.createLinearGradient(0, horizon, 0, rect.height);
  dirt.addColorStop(0, "#765f3f");
  dirt.addColorStop(0.55, "#5e472f");
  dirt.addColorStop(1, "#3c2b20");
  ctx.fillStyle = dirt;
  ctx.fillRect(0, horizon, rect.width, rect.height - horizon);

  ctx.strokeStyle = "rgba(210,177,122,.16)";
  ctx.lineWidth = 1;
  for (let i = 1; i < 9; i += 1) {
    const y = horizon + Math.pow(i / 9, 1.75) * (rect.height - horizon);
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(rect.width, y);
    ctx.stroke();
  }
}

function collectScenery(state, observer) {
  const items = [];
  for (let x = Math.floor(observer.x - 55); x <= observer.x + 55; x += 5) {
    for (let y = Math.floor(observer.y - 55); y <= observer.y + 55; y += 5) {
      const distance = Math.hypot(x - observer.x, y - observer.y);
      if (distance < 4 || distance > 58) continue;
      const terrain = terrainAt(x, y);
      const density = terrain === "dense" ? 0.74 : terrain === "forest" ? 0.54 : terrain === "brush" ? 0.24 : 0.1;
      const noise = Math.abs(Math.sin(x * 2.71 + y * 1.93));
      if (noise < density) items.push({ x, y, kind: "tree", variant: Math.floor(noise * 10) % 3, distance });
    }
  }
  for (const water of state.waterSources || []) items.push({ ...water, kind: "water", distance: Math.hypot(water.x - observer.x, water.y - observer.y) });
  for (const fire of state.fires || []) items.push({ ...fire, kind: "fire", distance: Math.hypot(fire.x - observer.x, fire.y - observer.y) });
  return items.filter((item) => item.distance < 62).sort((a, b) => b.distance - a.distance);
}

function projectToView(item, observer, rect, horizon) {
  const dx = item.x - observer.x;
  const dy = item.y - observer.y;
  const cos = Math.cos(observer.heading || 0);
  const sin = Math.sin(observer.heading || 0);
  const forward = dx * cos + dy * sin;
  const lateral = -dx * sin + dy * cos;
  if (forward <= 1 || forward > 75 || Math.abs(lateral) > forward * 1.05) return null;
  const x = rect.width / 2 + (lateral / forward) * rect.width * 0.58;
  const y = horizon + (1 - Math.min(1, forward / 70)) * (rect.height - horizon) * 0.88;
  const scale = Math.max(0.18, Math.min(2.3, 13 / forward));
  return { x, y, scale, forward };
}

function drawPerspectiveTree(ctx, projected, variant) {
  const h = (variant === 1 ? 112 : variant === 2 ? 86 : 98) * projected.scale;
  const w = h * (variant === 2 ? 0.52 : 0.42);
  ctx.fillStyle = "#4b301e";
  ctx.fillRect(projected.x - w * 0.08, projected.y - h * 0.5, w * 0.16, h * 0.5);
  ctx.fillStyle = variant === 1 ? "#176125" : variant === 2 ? "#58803d" : "#084218";
  for (let i = 0; i < 3; i += 1) {
    const cy = projected.y - h * (0.52 + i * 0.18);
    ctx.beginPath();
    ctx.moveTo(projected.x, cy - h * 0.28);
    ctx.lineTo(projected.x - w * (0.58 - i * 0.08), cy + h * 0.18);
    ctx.lineTo(projected.x + w * (0.58 - i * 0.08), cy + h * 0.18);
    ctx.closePath();
    ctx.fill();
  }
}

function drawPerspectiveWater(ctx, projected) {
  const width = 150 * projected.scale;
  ctx.fillStyle = "rgba(100,120,220,.88)";
  ctx.beginPath();
  ctx.ellipse(projected.x, projected.y, width, width * 0.22, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = "rgba(205,224,240,.65)";
  ctx.stroke();
}

function drawPerspectiveFire(ctx, projected, intensity = 1, tick = 0) {
  const h = (48 + intensity * 20) * projected.scale;
  ctx.fillStyle = "rgba(38,35,32,.34)";
  ctx.beginPath();
  ctx.ellipse(projected.x, projected.y - h * 1.6, h * 0.42, h * 1.25, 0, 0, Math.PI * 2);
  ctx.fill();
  for (let i = 0; i < 3; i += 1) {
    const sway = Math.sin(tick * 0.18 + i * 2.1) * h * 0.08;
    ctx.fillStyle = i === 0 ? "#cf2f02" : i === 1 ? "#f15b2a" : "#f6c343";
    ctx.beginPath();
    ctx.moveTo(projected.x - h * (0.3 - i * 0.07), projected.y);
    ctx.quadraticCurveTo(projected.x + sway, projected.y - h * (0.62 + i * 0.12), projected.x + h * (0.1 - i * 0.02), projected.y - h);
    ctx.quadraticCurveTo(projected.x + h * 0.38, projected.y - h * 0.34, projected.x + h * (0.3 - i * 0.07), projected.y);
    ctx.fill();
  }
}
