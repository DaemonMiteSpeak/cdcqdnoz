import { clamp } from '../lib/util';

export type FieldStats = { visited: number; steps: number; turns: number; reachable: boolean };
export type FieldLabels = { start: string; target: string; steps: string };
export type Rect = { x: number; y: number; w: number; h: number };
type Wave = { t0: number; cells: Int32Array; dist: Int16Array; max: number; head: number };
type PaintMode = 'add' | 'erase';

const DX = [1, 0, -1, 0];
const DY = [0, 1, 0, -1];
const INK = '#0c0c0d';
const PAPER = '#ece8df';
const SIGNAL = '#ff4a1c';
const FONT = '500 10px "Martian Mono Variable", ui-monospace, monospace';

/**
 * The hero background: a live breadth-first search on a grid.
 * Headline words and UI blocks are walls; the route runs from a fixed start
 * node to the pointer and is re-solved every time the pointer changes cell.
 */
export class PathField {
  labels: FieldLabels = { start: '', target: '', steps: '' };
  debug = false;

  private ctx: CanvasRenderingContext2D;
  private layer = document.createElement('canvas');
  private w = 0;
  private h = 0;
  private dpr = 1;
  private cell = 24;
  private cols = 0;
  private rows = 0;
  private ox = 0;
  private oy = 0;
  private fixed = new Uint8Array(0);
  private user = new Uint8Array(0);
  private prev = new Int32Array(0);
  private dist = new Int16Array(0);
  private queue = new Int32Array(0);
  private start = 0;
  private target = -1;
  private path: number[] = [];
  private reachable = true;
  private waves: Wave[] = [];
  private lastWave = 0;
  private pointer = { x: 0, y: 0, t: -1e9, inside: false };
  private raf = 0;
  private running = false;
  private layerDirty = true;
  private needSolve = true;

  constructor(
    private canvas: HTMLCanvasElement,
    private reduced: boolean,
    private onStats: (s: FieldStats) => void,
  ) {
    this.ctx = canvas.getContext('2d')!;
  }

  /** Rebuilds the grid for a new size and marks the given rects as walls. */
  layout(w: number, h: number, rects: Rect[], startPt: { x: number; y: number }) {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const cell = clamp(Math.round(w / 58), 16, 26);
    const cols = Math.ceil(w / cell);
    const rows = Math.ceil(h / cell);
    const resized = cols !== this.cols || rows !== this.rows;
    this.w = w;
    this.h = h;
    this.dpr = dpr;
    this.cell = cell;
    this.cols = cols;
    this.rows = rows;
    this.ox = (w - cols * cell) / 2;
    this.oy = (h - rows * cell) / 2;
    for (const c of [this.canvas, this.layer]) {
      c.width = Math.round(w * dpr);
      c.height = Math.round(h * dpr);
    }
    const n = cols * rows;
    if (resized) {
      this.user = new Uint8Array(n);
      this.prev = new Int32Array(n);
      this.dist = new Int16Array(n);
      this.queue = new Int32Array(n);
      this.waves = [];
    }
    this.fixed = new Uint8Array(n);
    for (const r of rects) {
      const x0 = Math.max(0, Math.ceil((r.x - this.ox) / cell - 0.5));
      const x1 = Math.min(cols - 1, Math.floor((r.x + r.w - this.ox) / cell - 0.5));
      const y0 = Math.max(0, Math.ceil((r.y - this.oy) / cell - 0.5));
      const y1 = Math.min(rows - 1, Math.floor((r.y + r.h - this.oy) / cell - 0.5));
      for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) this.fixed[y * cols + x] = 1;
    }
    this.start = this.freeNear(this.cellAt(startPt.x, startPt.y));
    this.user[this.start] = 0;
    this.layerDirty = true;
    this.needSolve = true;
  }

  setPointer(x: number, y: number) {
    this.pointer = { x, y, t: performance.now(), inside: true };
  }

  clearPointer() {
    this.pointer.inside = false;
  }

  /** Adds or removes a user wall. `toggle` decides from the cell under the pointer. */
  paint(x: number, y: number, mode: PaintMode | 'toggle'): PaintMode {
    const i = this.cellAt(x, y);
    const resolved: PaintMode = mode === 'toggle' ? (this.user[i] ? 'erase' : 'add') : mode;
    if (this.fixed[i] || i === this.start) return resolved;
    const next = resolved === 'add' ? 1 : 0;
    if (this.user[i] !== next) {
      this.user[i] = next;
      this.layerDirty = true;
      this.needSolve = true;
    }
    return resolved;
  }

  resetWalls() {
    this.user.fill(0);
    this.layerDirty = true;
    this.needSolve = true;
  }

  startLoop() {
    if (this.running) return;
    this.running = true;
    this.raf = requestAnimationFrame(this.frame);
  }

  stopLoop() {
    this.running = false;
    cancelAnimationFrame(this.raf);
  }

  private cellAt(x: number, y: number) {
    const cx = clamp(Math.floor((x - this.ox) / this.cell), 0, this.cols - 1);
    const cy = clamp(Math.floor((y - this.oy) / this.cell), 0, this.rows - 1);
    return cy * this.cols + cx;
  }

  private cxOf(i: number) {
    return this.ox + ((i % this.cols) + 0.5) * this.cell;
  }

  private cyOf(i: number) {
    return this.oy + (Math.floor(i / this.cols) + 0.5) * this.cell;
  }

  private blocked(i: number) {
    return this.fixed[i] === 1 || this.user[i] === 1;
  }

  /** Nearest open cell, searching outward in square rings. */
  private freeNear(i: number) {
    if (!this.blocked(i)) return i;
    const cx = i % this.cols;
    const cy = Math.floor(i / this.cols);
    for (let r = 1; r < 16; r++) {
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
          const x = cx + dx;
          const y = cy + dy;
          if (x < 0 || y < 0 || x >= this.cols || y >= this.rows) continue;
          const j = y * this.cols + x;
          if (!this.blocked(j)) return j;
        }
      }
    }
    return i;
  }

  private solve(now: number) {
    const { cols, rows, prev, dist, queue, start, target } = this;
    prev.fill(-1);
    dist.fill(-1);
    let head = 0;
    let tail = 0;
    queue[tail++] = start;
    dist[start] = 0;
    let found = start === target;
    while (head < tail && !found) {
      const c = queue[head++];
      const cx = c % cols;
      const cy = (c / cols) | 0;
      for (let k = 0; k < 4; k++) {
        const nx = cx + DX[k];
        const ny = cy + DY[k];
        if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) continue;
        const ni = ny * cols + nx;
        if (dist[ni] !== -1 || this.fixed[ni] || this.user[ni]) continue;
        dist[ni] = dist[c] + 1;
        prev[ni] = c;
        queue[tail++] = ni;
        if (ni === target) {
          found = true;
          break;
        }
      }
    }

    this.path = [];
    if (found) {
      for (let c = target; c !== -1; c = prev[c]) this.path.push(c);
      this.path.reverse();
    }
    this.reachable = found;
    this.needSolve = false;

    if (!this.reduced && now - this.lastWave > 150) {
      const cells = queue.slice(0, tail);
      const d = new Int16Array(tail);
      for (let i = 0; i < tail; i++) d[i] = dist[cells[i]];
      this.waves.push({ t0: now, cells, dist: d, max: d[tail - 1] || 1, head: 0 });
      if (this.waves.length > 4) this.waves.shift();
      this.lastWave = now;
    }
    let turns = 0;
    for (let i = 1; i < this.path.length - 1; i++) {
      if (this.path[i] - this.path[i - 1] !== this.path[i + 1] - this.path[i]) turns++;
    }
    this.onStats({ visited: tail, steps: Math.max(0, this.path.length - 1), turns, reachable: found });
  }

  private frame = (now: number) => {
    if (!this.running) return;
    this.raf = requestAnimationFrame(this.frame);
    if (!this.cols) return;

    const idle = !this.pointer.inside || now - this.pointer.t > 2600;
    let tx = this.pointer.x;
    let ty = this.pointer.y;
    if (idle) {
      // Nobody is steering: let the target drift so the search keeps running.
      tx = this.reduced ? this.w * 0.24 : this.w * (0.5 + 0.4 * Math.sin(now * 0.00023));
      ty = this.reduced ? this.h * 0.8 : this.h * (0.55 + 0.33 * Math.sin(now * 0.00037 + 1.3));
    }
    const cell = this.freeNear(this.cellAt(tx, ty));
    if (cell !== this.target || this.needSolve) {
      this.target = cell;
      this.solve(now);
    }
    this.draw(now);
  };

  private paintLayer() {
    const g = this.layer.getContext('2d')!;
    const { dpr, cell, cols, rows } = this;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, this.w, this.h);
    const dot = cell >= 22 ? 1.6 : 1.3;
    for (let i = 0; i < cols * rows; i++) {
      const x = this.cxOf(i);
      const y = this.cyOf(i);
      if (this.fixed[i]) {
        if (this.debug) {
          g.fillStyle = 'rgba(255,74,28,.25)';
          g.fillRect(x - cell / 2 + 1, y - cell / 2 + 1, cell - 2, cell - 2);
        }
        continue;
      }
      if (this.user[i]) {
        g.fillStyle = INK;
        g.fillRect(x - cell / 2 + 1.5, y - cell / 2 + 1.5, cell - 3, cell - 3);
      } else {
        g.fillStyle = 'rgba(12,12,13,.24)';
        g.fillRect(x - dot / 2, y - dot / 2, dot, dot);
      }
    }
    this.layerDirty = false;
  }

  private tag(text: string, x: number, y: number, align: 'left' | 'right', bg: string, fg: string) {
    const { ctx } = this;
    ctx.font = FONT;
    const padX = 7;
    const bh = 20;
    const tw = ctx.measureText(text).width;
    const bx = align === 'left' ? x : x - tw - padX * 2;
    ctx.fillStyle = bg;
    ctx.fillRect(bx, y - bh / 2, tw + padX * 2, bh);
    ctx.fillStyle = fg;
    ctx.textBaseline = 'middle';
    ctx.fillText(text, bx + padX, y + 0.5);
  }

  private draw(now: number) {
    const { ctx, dpr, w, h, cell } = this;
    if (this.layerDirty) this.paintLayer();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    ctx.drawImage(this.layer, 0, 0);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    // Search frontier: a band of visited cells sweeping outward from the start.
    const band = 6;
    const s = Math.max(3, cell * 0.2);
    ctx.fillStyle = SIGNAL;
    for (let wi = this.waves.length - 1; wi >= 0; wi--) {
      const wave = this.waves[wi];
      const front = ((now - wave.t0) / 1000) * Math.max(70, wave.max / 0.55);
      const len = wave.cells.length;
      while (wave.head < len && wave.dist[wave.head] < front - band) wave.head++;
      if (wave.head >= len) {
        this.waves.splice(wi, 1);
        continue;
      }
      for (let i = wave.head; i < len && wave.dist[i] <= front; i++) {
        ctx.globalAlpha = 0.85 * (1 - (front - wave.dist[i]) / band);
        const c = wave.cells[i];
        ctx.fillRect(this.cxOf(c) - s / 2, this.cyOf(c) - s / 2, s, s);
      }
    }
    ctx.globalAlpha = 1;

    const tx = this.cxOf(this.target);
    const ty = this.cyOf(this.target);

    // Plotter crosshair through the target.
    ctx.strokeStyle = 'rgba(12,12,13,.13)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, ty + 0.5);
    ctx.lineTo(w, ty + 0.5);
    ctx.moveTo(tx + 0.5, 0);
    ctx.lineTo(tx + 0.5, h);
    ctx.stroke();

    const path = this.path;
    if (path.length > 1) {
      // Keep only the corners, then round them like a PCB trace.
      const xs: number[] = [this.cxOf(path[0])];
      const ys: number[] = [this.cyOf(path[0])];
      for (let i = 1; i < path.length - 1; i++) {
        if (path[i] - path[i - 1] !== path[i + 1] - path[i]) {
          xs.push(this.cxOf(path[i]));
          ys.push(this.cyOf(path[i]));
        }
      }
      xs.push(tx);
      ys.push(ty);
      const trace = () => {
        ctx.beginPath();
        ctx.moveTo(xs[0], ys[0]);
        for (let i = 1; i < xs.length - 1; i++) ctx.arcTo(xs[i], ys[i], xs[i + 1], ys[i + 1], cell * 0.5);
        ctx.lineTo(xs[xs.length - 1], ys[ys.length - 1]);
      };
      ctx.lineJoin = 'round';
      ctx.lineCap = 'round';
      trace();
      ctx.strokeStyle = PAPER;
      ctx.lineWidth = 8;
      ctx.stroke();
      trace();
      ctx.strokeStyle = SIGNAL;
      ctx.lineWidth = 2.5;
      ctx.stroke();

      if (!this.reduced) {
        const segs = path.length - 1;
        const packets = Math.min(3, Math.max(1, Math.floor(segs / 12)));
        ctx.fillStyle = INK;
        for (let k = 0; k < packets; k++) {
          const pos = ((now / 1000) * 16 + (k * segs) / packets) % segs;
          const i0 = Math.floor(pos);
          const f = pos - i0;
          const px = this.cxOf(path[i0]) + (this.cxOf(path[i0 + 1]) - this.cxOf(path[i0])) * f;
          const py = this.cyOf(path[i0]) + (this.cyOf(path[i0 + 1]) - this.cyOf(path[i0])) * f;
          ctx.fillRect(px - 3, py - 3, 6, 6);
        }
      }
    }

    // Start node.
    const sx = this.cxOf(this.start);
    const sy = this.cyOf(this.start);
    const pulse = this.reduced ? 0.5 : (now / 1600) % 1;
    ctx.strokeStyle = INK;
    ctx.globalAlpha = 1 - pulse;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(sx, sy, 6 + pulse * 14, 0, Math.PI * 2);
    ctx.stroke();
    ctx.globalAlpha = 1;
    ctx.fillStyle = INK;
    ctx.beginPath();
    ctx.arc(sx, sy, 5.5, 0, Math.PI * 2);
    ctx.fill();
    if (this.labels.start) {
      const right = sx > w / 2;
      this.tag(this.labels.start, right ? sx - 16 : sx + 16, sy, right ? 'right' : 'left', PAPER, INK);
    }

    // Target marker and readout.
    const color = this.reachable ? SIGNAL : INK;
    ctx.fillStyle = PAPER;
    ctx.fillRect(tx - 8, ty - 8, 16, 16);
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.strokeRect(tx - 7, ty - 7, 14, 14);
    ctx.fillStyle = color;
    ctx.fillRect(tx - 2.5, ty - 2.5, 5, 5);
    if (this.labels.target) {
      const text = this.reachable
        ? `${this.labels.target} · ${Math.max(0, path.length - 1)} ${this.labels.steps}`
        : `${this.labels.target} · ✕`;
      const right = tx > w - 230;
      const ly = ty < 64 ? ty + 26 : ty - 26;
      this.tag(text, right ? tx + 8 : tx - 8, ly, right ? 'right' : 'left', INK, PAPER);
    }
  }
}
