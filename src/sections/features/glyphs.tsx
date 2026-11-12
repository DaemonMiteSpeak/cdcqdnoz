import type { ReactNode } from 'react';
import { cx, vars } from '../../lib/util';

/** A stroke that draws itself when its figure becomes active. `i` staggers the start. */
function Draw({ d, i = 0, accent = false }: { d: string; i?: number; accent?: boolean }) {
  return <path className={cx('g-line g-draw', accent && 'g-acc')} d={d} pathLength={1} style={vars({ '--d': i })} />;
}

const pop = (i: number) => vars({ '--d': i });

const ROUTE = 'M28 196H92V136H156V76H212';

function Assistant() {
  return (
    <svg viewBox="0 0 240 240">
      <path className="g-line g-dim g-dash" d="M92 196H168M156 136H214" />
      <Draw d={ROUTE} />
      <circle className="g-pop g-solid" cx="28" cy="196" r="5" style={pop(0)} />
      <g className="g-pop" style={pop(3)}>
        <circle className="g-line g-hole" cx="92" cy="196" r="11" />
        <text className="g-text" x="92" y="199.5" textAnchor="middle">
          ?
        </text>
      </g>
      <g className="g-pop" style={pop(6)}>
        <circle className="g-line g-hole" cx="156" cy="136" r="11" />
        <text className="g-text" x="156" y="139.5" textAnchor="middle">
          ?
        </text>
      </g>
      <g className="g-pop" style={pop(9)}>
        <rect className="g-fill" x="198" y="62" width="28" height="28" />
        <path className="g-line g-ink" d="M205 76l5 5 9-11" />
      </g>
      <circle className="g-fill g-runner" r="4.5">
        <animateMotion dur="3.4s" repeatCount="indefinite" path={ROUTE} />
      </circle>
    </svg>
  );
}

function Python() {
  return (
    <svg viewBox="0 0 240 240">
      <path className="g-line g-dim" d="M54 72V168" />
      <Draw d="M36 52H148" i={0} />
      <Draw d="M70 84H198" i={1} />
      <Draw d="M70 116H142" i={2} />
      <Draw d="M70 148H182" i={3} />
      <Draw d="M36 190H112" i={6} />
      <Draw d="M70 161q6-8 12 0t12 0 12 0 12 0 12 0 12 0 12 0 12 0 12 0" i={5} accent />
      <rect className="g-pop g-fill" x="36" y="46" width="26" height="12" style={pop(1)} />
      <rect className="g-pop g-fill" x="70" y="110" width="20" height="12" style={pop(3)} />
      <rect className="g-fill g-caret" x="120" y="181" width="5" height="18" />
      <text className="g-text" x="36" y="222">
        {'>>>'} 83.33
      </text>
    </svg>
  );
}

function Vision() {
  return (
    <svg viewBox="0 0 240 240">
      <Draw d="M28 62V28H62" i={0} />
      <Draw d="M178 28H212V62" i={1} />
      <Draw d="M212 178V212H178" i={2} />
      <Draw d="M62 212H28V178" i={3} />
      <Draw d="M120 58 164 98 120 138 76 98Z" i={4} />
      <Draw d="M120 138V160M84 160H156V192H84Z" i={6} />
      <path className="g-line g-acc" d="M113 98H127M120 91V105" />
      <g className="g-pop" style={pop(8)}>
        <rect className="g-fill" x="166" y="70" width="42" height="14" />
        <text className="g-text g-text--ink" x="170" y="80.5">
          0.98
        </text>
      </g>
      <g className="g-pop" style={pop(10)}>
        <rect className="g-fill" x="158" y="170" width="42" height="14" />
        <text className="g-text g-text--ink" x="162" y="180.5">
          0.96
        </text>
      </g>
      <path className="g-line g-acc g-scan" d="M28 40H212" />
    </svg>
  );
}

function Loop() {
  const nodes = Array.from({ length: 8 }, (_, k) => {
    const a = (k / 8) * Math.PI * 2 - Math.PI / 2;
    return [120 + 78 * Math.cos(a), 120 + 78 * Math.sin(a)] as const;
  });
  return (
    <svg viewBox="0 0 240 240">
      <circle className="g-line g-draw" cx="120" cy="120" r="78" pathLength={1} style={pop(0)} />
      <Draw d="M120 84 156 120 120 156 84 120Z" i={3} />
      {nodes.map(([x, y], k) => (
        <circle key={k} className="g-pop g-solid" cx={x} cy={y} r="4" style={pop(k + 2)} />
      ))}
      <text className="g-text" x="120" y="123.5" textAnchor="middle">
        i &lt; n
      </text>
      <g className="g-orbit">
        <rect className="g-fill" x="110" y="32" width="20" height="20" />
      </g>
    </svg>
  );
}

function Resources() {
  const sheets = [-2, 2, -1, 1, 0];
  return (
    <svg viewBox="0 0 240 240">
      {sheets.map((k) => (
        <g key={k} className="g-sheet" style={vars({ '--k': k })}>
          <rect className="g-line g-hole" x="66" y="50" width="108" height="140" />
          {k === 0 && (
            <>
              <path className="g-line" d="M82 92H138M82 112H158M82 132H148M82 152H122" />
              <rect className="g-fill" x="82" y="64" width="34" height="12" />
              <path className="g-line g-acc" d="M150 50V78L160 70 170 78V50" />
            </>
          )}
        </g>
      ))}
    </svg>
  );
}

function Progress() {
  const bars = Array.from({ length: 11 }, (_, i) => ({ x: 24 + i * 18, h: 22 + i * 13 }));
  const trend = bars
    .slice(0, 7)
    .map((b, i) => `${i ? 'L' : 'M'}${b.x + 6} ${196 - b.h - 10}`)
    .join('');
  return (
    <svg viewBox="0 0 240 240">
      <Draw d="M18 204H224" i={0} />
      {bars.map((b, i) => (
        <rect
          key={i}
          className={cx('g-pop g-bar', i < 7 ? 'g-fill' : 'g-line g-dim')}
          x={b.x}
          y={196 - b.h}
          width="12"
          height={b.h}
          style={pop(i + 1)}
        />
      ))}
      <Draw d={trend} i={9} />
      <text className="g-text g-text--big" x="24" y="52">
        07/11
      </text>
    </svg>
  );
}

export const GLYPHS: Array<() => ReactNode> = [Assistant, Python, Vision, Loop, Resources, Progress];
