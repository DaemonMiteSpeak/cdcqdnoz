import { useEffect, useMemo, useState } from 'react';
import { fmt, useI18n } from '../../i18n';
import { Code } from '../../lib/highlight';
import { cx, mulberry32, pad, vars } from '../../lib/util';

export const MODULES = [
  { track: 'hw', progress: 100 },
  { track: 'logic', progress: 100 },
  { track: 'py', progress: 64 },
  { track: 'game', progress: 45 },
  { track: 'game', progress: 30 },
  { track: 'db', progress: 15 },
  { track: 'db', progress: 8 },
  { track: 'data', progress: 0 },
  { track: 'data', progress: 0 },
  { track: 'js', progress: 0 },
  { track: 'js', progress: 0 },
] as const;

const EXERCISES: Record<string, string[]> = {
  hw: ['ip_classes.py', 'subnet_mask.py', 'osi_layers.md', 'mac_vs_ip.md', 'ping_trace.py'],
  logic: ['bin_to_hex.py', 'truth_table.py', 'de_morgan.py', 'xor_cipher.py', 'base_convert.py'],
  py: ['bubble_sort.py', 'binary_search.py', 'stack_queue.py', 'class_student.py', 'recursion_sum.py'],
  game: ['sprite_move.py', 'collision_box.py', 'score_hud.py', 'enemy_spawn.py', 'game_loop.py'],
  db: ['select_where.sql', 'join_tables.sql', 'group_by.sql', 'primary_keys.sql', 'insert_rows.sql'],
  data: ['read_csv.py', 'mean_median.py', 'bar_chart.py', 'filter_rows.py', 'clean_nulls.py'],
  js: ['dom_query.js', 'event_click.js', 'array_map.js', 'fetch_json.js', 'form_check.js'],
};

/* ---------------------------------- Dashboard ---------------------------------- */

export function DashView({ mod }: { mod: number }) {
  const { t } = useI18n();
  const a = t.showcase.app;
  const m = MODULES[mod];
  const files = EXERCISES[m.track];
  const solved = Math.round((m.progress / 100) * files.length);
  const week = useMemo(() => {
    const rand = mulberry32(mod * 13 + 5);
    return Array.from({ length: 7 }, () => (m.progress === 0 ? 4 : 18 + Math.round(rand() * 82)));
  }, [mod, m.progress]);
  const streak = m.progress === 0 ? 0 : 3 + ((mod * 5) % 11);

  return (
    <div className="dash">
      <div className="dash__head">
        <div>
          <span className="mono dash__kicker">
            {a.dash.module} {pad(mod + 1)} · {a.dash.progress}
          </span>
          <h3 className="dash__title display">{a.moduleNames[mod]}</h3>
        </div>
        <div className="dash__pct display">
          {m.progress}
          <small>%</small>
        </div>
      </div>

      <div className="dash__meter" role="img" aria-label={`${a.dash.progress}: ${m.progress}%`}>
        {Array.from({ length: 40 }, (_, i) => (
          <i key={i} className={i < (m.progress / 100) * 40 ? 'is-on' : undefined} style={vars({ '--i': i })} />
        ))}
      </div>

      <div className="dash__grid">
        <div>
          <span className="mono dash__label">
            {a.dash.exercises} — {solved}/{files.length} {a.dash.done}
          </span>
          <ul>
            {files.map((file, i) => {
              const state = i < solved ? 'solved' : i === solved && m.progress > 0 ? 'progress' : 'new';
              const label = state === 'solved' ? a.dash.solved : state === 'progress' ? a.dash.inProgress : a.dash.fresh;
              return (
                <li key={file} className={`dash__row is-${state}`} style={vars({ '--i': i })}>
                  <span className="mono dash__no">{pad(i + 1)}</span>
                  <span className="dash__file">{file}</span>
                  <span className="mono dash__state">{label}</span>
                </li>
              );
            })}
          </ul>
        </div>
        <div className="dash__aside">
          <span className="mono dash__label">{a.dash.week}</span>
          <div className="dash__bars" aria-hidden="true">
            {week.map((v, i) => (
              <i key={i} className={i === 4 ? 'is-today' : undefined} style={vars({ '--i': i, '--h': `${v}%` })} />
            ))}
          </div>
          <div className="dash__streak">
            <b className="display">{streak}</b>
            <span className="mono">{a.dash.streak}</span>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------- Python assistant ------------------------------- */

const BROKEN = `def average(scores):
    total = 0
    for s in scores:
        total += s
    return total / len(score)

print(round(average([82, 91, 77]), 2))`;
const FIXED = BROKEN.replace('len(score)', 'len(scores)');
const TRACEBACK = `Traceback (most recent call last):
  File "average.py", line 5, in average
NameError: name 'score' is not defined`;

export function PyView({ auto }: { auto: boolean }) {
  const { t } = useI18n();
  const p = t.showcase.app.py;
  const [phase, setPhase] = useState<'idle' | 'running' | 'done'>('idle');
  const [fixed, setFixed] = useState(false);

  // idle → running → done; in autoplay the fix is applied without a click.
  useEffect(() => {
    let id = 0;
    if (phase === 'idle' && auto) id = window.setTimeout(() => setPhase('running'), 1200);
    else if (phase === 'running') id = window.setTimeout(() => setPhase('done'), 950);
    else if (phase === 'done' && !fixed && auto) {
      id = window.setTimeout(() => {
        setFixed(true);
        setPhase('running');
      }, 3600);
    }
    return () => clearTimeout(id);
  }, [phase, fixed, auto]);

  const failed = phase === 'done' && !fixed;
  const passed = phase === 'done' && fixed;

  return (
    <div className="py">
      <div className="py__editor">
        <div className="py__file mono">
          <span>average.py</span>
          <span>{fixed ? '● saved' : 'Python 3.12'}</span>
        </div>
        <Code
          className="py__code"
          code={fixed ? FIXED : BROKEN}
          error={failed ? 4 : undefined}
          active={fixed ? 4 : undefined}
        />
        <div className="py__console" aria-live="polite">
          <span className="mono py__console-h">{p.output}</span>
          {phase === 'idle' && <span className="py__caret">{'>>> '}</span>}
          {phase === 'running' && <span className="py__caret">{'>>> python average.py '}</span>}
          {failed && <span className="py__err">{TRACEBACK}</span>}
          {passed && <span className="py__ok">83.33</span>}
        </div>
      </div>

      <div className="py__panel">
        <span className="mono dash__label">{p.title}</span>
        {phase === 'idle' && <p className="py__msg">{p.idle}</p>}
        {phase === 'running' && <p className="py__msg">{p.running}</p>}
        {failed && (
          <>
            <div className="py__msg py__msg--err">
              <h4 className="mono">{p.errorTitle}</h4>
              <p>{p.explain}</p>
            </div>
            <p className="py__msg py__msg--hint">{p.hint}</p>
          </>
        )}
        {passed && (
          <div className="py__msg py__msg--ok">
            <h4 className="mono">{p.fixedTitle}</h4>
            <p>{p.fixed}</p>
          </div>
        )}
        <div className="py__actions">
          <button type="button" className="abtn" disabled={phase === 'running'} onClick={() => setPhase('running')}>
            ▶ {p.run}
          </button>
          <button
            type="button"
            className="abtn abtn--primary"
            disabled={!failed}
            onClick={() => {
              setFixed(true);
              setPhase('running');
            }}
          >
            {p.fix}
          </button>
          <button
            type="button"
            className="abtn"
            disabled={phase === 'idle' && !fixed}
            onClick={() => {
              setFixed(false);
              setPhase('idle');
            }}
          >
            {p.reset}
          </button>
        </div>
      </div>
    </div>
  );
}

/* -------------------------------- Visual analysis -------------------------------- */

const BOXES = [
  { x: 106, y: 6, w: 88, h: 38, conf: '0.99' },
  { x: 84, y: 58, w: 132, h: 38, conf: '0.97' },
  { x: 82, y: 112, w: 136, h: 80, conf: '0.98' },
  { x: 6, y: 212, w: 100, h: 38, conf: '0.96' },
  { x: 194, y: 212, w: 100, h: 38, conf: '0.96' },
  { x: 106, y: 294, w: 88, h: 38, conf: '0.99' },
];
const VISION_CODE = `n = int(input())
if n % 2 == 0:
    print("even")
else:
    print("odd")`;

export function VisionView() {
  const { t } = useI18n();
  const v = t.showcase.app.vision;
  const [run, setRun] = useState(0);

  return (
    <div className="vis" key={run}>
      <div className="vis__photo">
        <span className="mono vis__name">worksheet_p14.jpg</span>
        <div className="vis__sheet">
          <svg viewBox="0 0 300 340" role="img" aria-label={v.readingText}>
            <g fill="none" stroke="#1b1b1d" strokeWidth="1.6" strokeLinejoin="round">
              <rect x="110" y="10" width="80" height="30" rx="15" />
              <path d="M150 40v22M150 92v24M150 282v16" />
              <path d="M100 62h110l-10 30H90z" />
              <path d="M150 116l62 36-62 36-62-36z" />
              <path d="M88 152H52v64M212 152h36v64" />
              <path d="M20 216h80l-8 30H12zM208 216h80l-8 30h-80z" />
              <path d="M52 246v36h196v-36" />
              <rect x="110" y="298" width="80" height="30" rx="15" />
            </g>
            <g className="vis__ink" textAnchor="middle">
              <text x="150" y="29">start</text>
              <text x="150" y="81">input n</text>
              <text x="150" y="156">n % 2 == 0 ?</text>
              <text x="56" y="235">print "even"</text>
              <text x="244" y="235">print "odd"</text>
              <text x="150" y="317">end</text>
              <text x="68" y="146">{v.yes}</text>
              <text x="232" y="146">{v.no}</text>
            </g>
            {BOXES.map((b, i) => (
              <g key={i} className="vis__box" style={vars({ '--i': i })}>
                <rect x={b.x} y={b.y} width={b.w} height={b.h} />
                <rect className="vis__tag" x={b.x} y={b.y - 11} width={v.labels[i].length * 4.6 + 30} height="11" />
                <text x={b.x + 3} y={b.y - 3}>
                  {v.labels[i]} {b.conf}
                </text>
              </g>
            ))}
            <rect className="vis__scan" x="0" y="0" width="300" height="3" />
          </svg>
        </div>
      </div>

      <div className="vis__out">
        <div className="vis__res" style={vars({ '--i': 0 })}>
          <span className="mono dash__label">{v.detected}</span>
          <p className="vis__big display">{v.shapes}</p>
        </div>
        <div className="vis__res" style={vars({ '--i': 1 })}>
          <span className="mono dash__label">{v.reading}</span>
          <p>{v.readingText}</p>
        </div>
        <div className="vis__res vis__res--code" style={vars({ '--i': 2 })}>
          <span className="mono dash__label">{v.asCode}</span>
          <Code code={VISION_CODE} className="vis__code" />
        </div>
        <button type="button" className="abtn vis__again" onClick={() => setRun((n) => n + 1)}>
          ↻ {v.again}
        </button>
      </div>
    </div>
  );
}

/* ---------------------------------- Algorithm ---------------------------------- */

const ARR = [3, 8, 12, 17, 21, 26, 31, 35, 42, 47, 53, 58, 64, 71, 77];
const SEARCH_CODE = `def binary_search(a, x):
    lo, hi = 0, len(a) - 1
    while lo <= hi:
        mid = (lo + hi) // 2
        if a[mid] == x: return mid
        if a[mid] < x: lo = mid + 1
        else: hi = mid - 1`;

type Frame = { lo: number; hi: number; mid: number; kind: 'init' | 'eq' | 'lt' | 'gt' };

function buildFrames(x: number): Frame[] {
  const frames: Frame[] = [{ lo: 0, hi: ARR.length - 1, mid: -1, kind: 'init' }];
  let lo = 0;
  let hi = ARR.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const kind = ARR[mid] === x ? 'eq' : ARR[mid] < x ? 'lt' : 'gt';
    frames.push({ lo, hi, mid, kind });
    if (kind === 'eq') break;
    if (kind === 'lt') lo = mid + 1;
    else hi = mid - 1;
  }
  return frames;
}

export function AlgoView() {
  const { t } = useI18n();
  const a = t.showcase.app.algo;
  const [target, setTarget] = useState(64);
  const [step, setStep] = useState(0);
  const [playing, setPlaying] = useState(true);
  const frames = useMemo(() => buildFrames(target), [target]);
  const f = frames[Math.min(step, frames.length - 1)];
  const atEnd = step >= frames.length - 1;

  useEffect(() => {
    if (!playing || atEnd) return;
    const id = window.setTimeout(() => setStep((s) => s + 1), step === 0 ? 1100 : 1500);
    return () => clearTimeout(id);
  }, [playing, atEnd, step]);

  const restart = (next = target) => {
    setTarget(next);
    setStep(0);
    setPlaying(true);
  };

  const v = f.mid >= 0 ? ARR[f.mid] : 0;
  const message =
    f.kind === 'init'
      ? a.init
      : f.kind === 'eq'
        ? fmt(a.found, { i: f.mid, n: step })
        : f.kind === 'lt'
          ? `a[${f.mid}] = ${v} < ${target} → ${a.dropLeft}`
          : `a[${f.mid}] = ${v} > ${target} → ${a.dropRight}`;
  const line = { init: 1, eq: 4, lt: 5, gt: 6 }[f.kind];

  return (
    <div className="algo">
      <div className="algo__viz">
        <div className="algo__head">
          <h3 className="algo__title display">{a.title}</h3>
          <span className="mono algo__find">
            {a.find} <b>{target}</b>
          </span>
        </div>

        <div className="algo__cells">
          {ARR.map((n, i) => {
            const out = i < f.lo || i > f.hi;
            const drop = (f.kind === 'lt' && i >= f.lo && i < f.mid) || (f.kind === 'gt' && i > f.mid && i <= f.hi);
            const ptr = [i === f.lo && 'lo', i === f.mid && 'mid', i === f.hi && 'hi'].filter(Boolean).join('\n');
            return (
              <button
                key={n}
                type="button"
                className={cx(
                  'algo__cell',
                  out && 'is-out',
                  drop && 'is-drop',
                  i === f.mid && (f.kind === 'eq' ? 'is-found' : 'is-mid'),
                  n === target && 'is-target',
                )}
                aria-label={`${a.find} ${n}`}
                onClick={() => restart(n)}
              >
                <span className="algo__val">{n}</span>
                <span className="algo__idx">{i}</span>
                <span className="algo__ptr">{ptr}</span>
              </button>
            );
          })}
        </div>

        <p className="algo__msg" aria-live="polite" key={`${target}-${step}`}>
          <span className="mono algo__step">{pad(step)}</span>
          {message}
        </p>

        <div className="algo__ctl">
          <button type="button" className="abtn abtn--primary" disabled={atEnd} onClick={() => setPlaying((p) => !p)}>
            {playing && !atEnd ? `❚❚ ${a.pause}` : `▶ ${a.play}`}
          </button>
          <button
            type="button"
            className="abtn"
            disabled={atEnd}
            onClick={() => {
              setPlaying(false);
              setStep((s) => s + 1);
            }}
          >
            {a.step} →
          </button>
          <button type="button" className="abtn" onClick={() => restart()}>
            ↻ {a.restart}
          </button>
          <span className="mono algo__pick">{a.pick}</span>
        </div>
      </div>

      <div className="algo__code">
        <div className="py__file mono">
          <span>binary_search.py</span>
          <span>O(log n)</span>
        </div>
        <Code code={SEARCH_CODE} active={line} className="py__code" />
      </div>
    </div>
  );
}
