import { useState } from 'react';
import { useI18n } from '../../i18n';
import { Code, type CodeLang } from '../../lib/highlight';
import { cx } from '../../lib/util';

/* Module 1 — IP addressing: slide the prefix, watch the mask move. */

const IP = [192, 168, 10, 37];
const IP_NUM = IP.reduce((acc, octet) => ((acc << 8) | octet) >>> 0, 0);
const dotted = (n: number) => [24, 16, 8, 0].map((shift) => (n >>> shift) & 255).join('.');

export function SubnetWidget() {
  const { t, lang } = useI18n();
  const w = t.courses.w;
  const [prefix, setPrefix] = useState(24);
  const mask = (0xffffffff << (32 - prefix)) >>> 0;
  const bits = IP_NUM.toString(2).padStart(32, '0');
  const hosts = 2 ** (32 - prefix) - 2;

  return (
    <div className="w-ip">
      <p className="w-ip__addr display">
        {IP.join('.')}
        <span>/{prefix}</span>
      </p>
      <div className="w-ip__bits" aria-hidden="true">
        {[0, 1, 2, 3].map((octet) => (
          <div key={octet} className="w-ip__octet">
            {bits
              .slice(octet * 8, octet * 8 + 8)
              .split('')
              .map((bit, i) => (
                <span key={i} className={octet * 8 + i < prefix ? 'is-net' : 'is-host'}>
                  {bit}
                </span>
              ))}
          </div>
        ))}
      </div>
      <div className="w-ip__legend mono" aria-hidden="true">
        <span>
          <i className="is-net" /> {prefix} {w.netBits}
        </span>
        <span>
          <i className="is-host" /> {32 - prefix} {w.hostBits}
        </span>
      </div>
      <label className="w-range">
        <span className="mono">
          {w.prefix} /{prefix}
        </span>
        <input
          type="range"
          min={8}
          max={30}
          value={prefix}
          onChange={(e) => setPrefix(Number(e.target.value))}
          aria-valuetext={`/${prefix}`}
        />
      </label>
      <dl className="w-out" aria-live="polite">
        <dt>{w.mask}</dt>
        <dd>{dotted(mask)}</dd>
        <dt>{w.network}</dt>
        <dd>{dotted((IP_NUM & mask) >>> 0)}</dd>
        <dt>{w.hosts}</dt>
        <dd>{hosts.toLocaleString(lang === 'en' ? 'en-US' : 'ru-RU')}</dd>
      </dl>
    </div>
  );
}

/* Module 2 — number systems: eight switches, four readouts. */

export function BitsWidget() {
  const { t } = useI18n();
  const w = t.courses.w;
  const [value, setValue] = useState(0b00101010);

  return (
    <div className="w-bits">
      <div className="w-bits__row">
        {Array.from({ length: 8 }, (_, i) => {
          const weight = 1 << (7 - i);
          const on = (value & weight) !== 0;
          return (
            <button
              key={i}
              type="button"
              className="w-bit"
              aria-pressed={on}
              aria-label={`${weight}`}
              onClick={() => setValue((v) => v ^ weight)}
            >
              <span className="w-bit__sw display">{on ? 1 : 0}</span>
              <span className="w-bit__wt">{weight}</span>
            </button>
          );
        })}
      </div>
      <dl className="w-out w-out--big" aria-live="polite">
        <dt>{w.dec}</dt>
        <dd>{value}</dd>
        <dt>{w.hex}</dt>
        <dd>0x{value.toString(16).toUpperCase().padStart(2, '0')}</dd>
        <dt>{w.oct}</dt>
        <dd>0o{value.toString(8).padStart(3, '0')}</dd>
        <dt>{w.bin}</dt>
        <dd>0b{value.toString(2).padStart(8, '0')}</dd>
      </dl>
    </div>
  );
}

/* Module 3 — data structures: a stack you can push and pop. */

const FEED = [25, 9, 14, 31, 5, 18, 42, 7];
const CAPACITY = 6;

export function StackWidget() {
  const { t } = useI18n();
  const w = t.courses.w;
  const [stack, setStack] = useState([7, 12, 3]);
  const [cursor, setCursor] = useState(0);
  const [log, setLog] = useState('stack = [7, 12, 3]');

  const push = () => {
    if (stack.length >= CAPACITY) return setLog(`# ${w.full}`);
    const v = FEED[cursor % FEED.length];
    setStack([...stack, v]);
    setCursor(cursor + 1);
    setLog(`stack.append(${v})`);
  };
  const pop = () => {
    if (!stack.length) return setLog('IndexError: pop from empty list');
    setLog(`stack.pop()  # → ${stack[stack.length - 1]}`);
    setStack(stack.slice(0, -1));
  };

  return (
    <div className="w-stack">
      <div className="w-stack__col" aria-live="polite">
        {stack.length === 0 && <span className="w-stack__empty mono">{w.empty}</span>}
        {stack.map((v, i) => (
          <span key={`${i}-${v}`} className="w-stack__item">
            <span>{v}</span>
            {i === stack.length - 1 && <span className="mono">← {w.top}</span>}
          </span>
        ))}
      </div>
      <div className="w-stack__side">
        <div className="w-stack__btns">
          <button type="button" className="w-btn w-btn--primary" onClick={push}>
            {w.push} ↓
          </button>
          <button type="button" className="w-btn" onClick={pop}>
            {w.pop} ↑
          </button>
        </div>
        <Code code={log} className="w-log" />
        <p className="mono w-stack__len">len(stack) = {stack.length}</p>
      </div>
    </div>
  );
}

/* Modules 4–11 — one snippet per track. */

const TRACKS: Array<{ lang: CodeLang; code: string }> = [
  {
    lang: 'py',
    code: `while running:
    hero.x += speed * dt
    if hero.hits(coin):
        score += 1
    draw(hero, coin, score)`,
  },
  {
    lang: 'sql',
    code: `SELECT name, score
FROM students
WHERE grade = 10
ORDER BY score DESC
LIMIT 5;`,
  },
  {
    lang: 'py',
    code: `scores = [82, 91, 77, 68]
mean = sum(scores) / len(scores)
best = max(scores)
print(best - mean)
# 11.5`,
  },
  {
    lang: 'js',
    code: `let count = 0;
button.addEventListener('click', () => {
  count += 1;
  label.textContent = count;
});`,
  },
];

export function TracksWidget() {
  const { t } = useI18n();
  const names = t.courses.groups[3].topics;
  const [track, setTrack] = useState(0);

  return (
    <div className="w-tracks">
      <div className="w-tracks__tabs">
        {names.map((name, i) => (
          <button
            key={name}
            type="button"
            className={cx('w-btn', track === i && 'w-btn--on')}
            aria-pressed={track === i}
            onClick={() => setTrack(i)}
          >
            {name}
          </button>
        ))}
      </div>
      <Code key={track} code={TRACKS[track].code} lang={TRACKS[track].lang} className="w-tracks__code" />
    </div>
  );
}
