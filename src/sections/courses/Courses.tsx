import { useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react';
import { SectionHead } from '../../components/primitives';
import { useI18n } from '../../i18n';
import { cx, pad, vars } from '../../lib/util';
import { BitsWidget, StackWidget, SubnetWidget, TracksWidget } from './widgets';
import './courses.css';

const GROUPS = [[1], [2], [3], [4, 5, 6, 7, 8, 9, 10, 11]];
const WIDGETS = [SubnetWidget, BitsWidget, StackWidget, TracksWidget];

export function Courses() {
  const { t } = useI18n();
  const c = t.courses;
  const tape = useRef<HTMLDivElement>(null);
  const [sel, setSel] = useState(0);
  const [head, setHead] = useState({ x: 0, w: 0 });

  // The read head is one element that slides and stretches to the selected group.
  useLayoutEffect(() => {
    const el = tape.current!;
    const measure = () => {
      const group = el.querySelector<HTMLElement>(`[data-group="${sel}"]`);
      if (group) setHead({ x: group.offsetLeft, w: group.offsetWidth });
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [sel]);

  const onKey = (e: KeyboardEvent) => {
    const dir = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
    if (!dir) return;
    e.preventDefault();
    const next = (sel + dir + GROUPS.length) % GROUPS.length;
    setSel(next);
    tape.current?.querySelector<HTMLElement>(`[data-group="${next}"]`)?.focus();
  };

  const group = c.groups[sel];
  const Widget = WIDGETS[sel];
  const title = sel < 3 ? `${c.module} ${pad(sel + 1)}` : `${c.modules} 04–11`;

  return (
    <section id="courses" className="section courses" data-theme="ink" data-section>
      <SectionHead index="04" eyebrow={c.eyebrow} title={c.title} lede={c.lede} />

      <div
        ref={tape}
        className="tape"
        role="tablist"
        aria-label={c.eyebrow}
        onKeyDown={onKey}
        style={vars({ '--x': `${head.x}px`, '--w': `${head.w}px` })}
      >
        <span className="tape__head" aria-hidden="true" />
        {GROUPS.map((cells, gi) => (
          <button
            key={gi}
            type="button"
            role="tab"
            id={`course-tab-${gi}`}
            data-group={gi}
            aria-selected={sel === gi}
            aria-controls="course-panel"
            aria-label={gi < 3 ? `${c.module} ${gi + 1}` : `${c.modules} 4–11`}
            tabIndex={sel === gi ? 0 : -1}
            className={cx('tape__group', sel === gi && 'is-on')}
            style={{ flexGrow: cells.length }}
            onClick={() => setSel(gi)}
          >
            {cells.map((n) => (
              <span key={n} className="tape__cell display">
                {pad(n)}
              </span>
            ))}
          </button>
        ))}
      </div>

      <div id="course-panel" role="tabpanel" aria-labelledby={`course-tab-${sel}`} className="cpanel" key={sel}>
        <div className="cpanel__info">
          <p className="cpanel__kicker mono">
            <span>{title}</span>
            <span>
              {group.topics.length} {c.topics}
            </span>
          </p>
          <ol className="cpanel__topics">
            {group.topics.map((topic, i) => (
              <li key={topic} style={vars({ '--i': i })}>
                <span className="mono">{pad(i + 1)}</span>
                <span className="display">{topic}</span>
              </li>
            ))}
          </ol>
        </div>

        <div className="cpanel__lab">
          <div className="cpanel__lab-head mono">
            <span>{c.tryIt}</span>
            <span>{group.widget}</span>
          </div>
          <Widget />
          <p className="cpanel__hint">{group.hint}</p>
        </div>
      </div>
    </section>
  );
}
