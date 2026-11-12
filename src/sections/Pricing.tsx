import { useRef, useState, type PointerEvent } from 'react';
import { Button } from '../components/Button';
import { Check, SectionHead } from '../components/primitives';
import { LINKS, PLANS } from '../config';
import { formatPrice, useI18n } from '../i18n';
import { useInView } from '../lib/hooks';
import { cx, pad, vars } from '../lib/util';
import './pricing.css';

const THEMES = ['paper', 'signal', 'ink'] as const;

function Ticket({ index, selected, onSelect }: { index: number; selected: boolean; onSelect: () => void }) {
  const { t, lang } = useI18n();
  const p = t.pricing;
  const plan = PLANS[index];
  const copy = p.plans[index];
  const ref = useRef<HTMLLIElement>(null);
  const inView = useInView(ref, { margin: '0px 0px -8% 0px' });

  const tilt = (e: PointerEvent<HTMLLIElement>) => {
    if (e.pointerType !== 'mouse') return;
    const el = e.currentTarget;
    const r = el.getBoundingClientRect();
    el.style.setProperty('--ry', `${(((e.clientX - r.left) / r.width - 0.5) * 9).toFixed(2)}deg`);
    el.style.setProperty('--rx', `${(((e.clientY - r.top) / r.height - 0.5) * -7).toFixed(2)}deg`);
  };
  const settle = (e: PointerEvent<HTMLLIElement>) => {
    e.currentTarget.style.setProperty('--ry', '0deg');
    e.currentTarget.style.setProperty('--rx', '0deg');
  };

  return (
    <li
      ref={ref}
      className={cx('ticket', plan.popular && 'is-popular', inView && 'is-in', selected && 'is-selected')}
      data-theme={THEMES[index]}
      style={vars({ '--i': index })}
      onPointerMove={tilt}
      onPointerLeave={settle}
    >
      <div className="ticket__inner">
        {plan.popular && <span className="ticket__stamp mono">{p.popular}</span>}
        <div className="ticket__stub mono">
          <span>
            {p.pass} {pad(index + 1)} / 03
          </span>
          <span className="ticket__punch" aria-hidden="true" />
        </div>

        <h3 className="ticket__name">{copy.name}</h3>
        <p className="ticket__price display">
          <span>{formatPrice(plan.price, lang)}</span>
          <span className="ticket__cur" aria-label="AZN">
            ₼
          </span>
        </p>
        <p className="ticket__perday mono">
          ≈ {formatPrice(plan.price / plan.days, lang)} ₼ {p.perDay}
        </p>

        <div className="ticket__days" style={vars({ '--cols': Math.min(plan.days, 10) })} aria-hidden="true">
          {Array.from({ length: plan.days }, (_, i) => (
            <i key={i} style={vars({ '--d': i })} />
          ))}
        </div>
        <p className="ticket__span mono">{p.days[index]}</p>

        <div className="ticket__perf" aria-hidden="true" />

        <ul className="ticket__list">
          {copy.features.map((feature) => (
            <li key={feature}>
              <Check />
              {feature}
            </li>
          ))}
        </ul>

        <Button
          variant={index === 2 ? 'signal' : 'solid'}
          size="lg"
          icon={selected ? 'none' : 'arrow'}
          aria-pressed={selected}
          onClick={onSelect}
        >
          {selected ? `✓ ${p.chosen}` : p.choose}
        </Button>

        <div className="ticket__code mono" aria-hidden="true">
          <span className="ticket__barcode" />
          <span>ALGO-{pad(plan.days)}D</span>
        </div>
      </div>
    </li>
  );
}

export function Pricing() {
  const { t } = useI18n();
  const p = t.pricing;
  const [selected, setSelected] = useState<number | null>(null);

  return (
    <section id="pricing" className="section pricing" data-theme="paper-2" data-section>
      <SectionHead index="06" eyebrow={p.eyebrow} title={p.title} lede={p.lede} />

      <ul className="pricing__grid">
        {PLANS.map((plan, i) => (
          <Ticket
            key={plan.id}
            index={i}
            selected={selected === i}
            onSelect={() => setSelected((cur) => (cur === i ? null : i))}
          />
        ))}
      </ul>

      <div className={cx('pricing__after', selected !== null && 'is-on')} aria-live="polite">
        {selected !== null && (
          <div className="pricing__after-in" key={selected}>
            <p>
              <strong>{p.plans[selected].name}</strong> {p.selectedMsg}
            </p>
            <div className="pricing__after-cta">
              <Button href={LINKS.download} size="sm" icon="down">
                {t.nav.download}
              </Button>
              <a className="ulink mono" href={LINKS.telegram} target="_blank" rel="noreferrer">
                {p.getKey} ↗
              </a>
            </div>
          </div>
        )}
      </div>

      <p className="pricing__foot">
        <span>
          {p.refundLead}{' '}
          <a className="ulink" href={LINKS.refund}>
            {p.refund}
          </a>
        </span>
        <span className="mono">{p.currency}</span>
      </p>
    </section>
  );
}
