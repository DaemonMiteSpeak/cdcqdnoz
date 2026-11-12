import { useRef, type MouseEventHandler, type PointerEvent, type ReactNode } from 'react';
import { cx } from '../lib/util';

type Props = {
  children: ReactNode;
  href?: string;
  onClick?: MouseEventHandler<HTMLElement>;
  variant?: 'solid' | 'ghost' | 'signal';
  size?: 'sm' | 'md' | 'lg' | 'xl';
  icon?: 'arrow' | 'down' | 'none';
  magnetic?: boolean;
  className?: string;
  target?: string;
  rel?: string;
  disabled?: boolean;
  'aria-pressed'?: boolean;
};

const ICONS = {
  arrow: 'M1 7h11.5M8 2.5 12.5 7 8 11.5',
  down: 'M7 1v11.5M2.5 8 7 12.5 11.5 8',
};

function Icon({ kind }: { kind: 'arrow' | 'down' }) {
  const glyph = (
    <svg viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
      <path d={ICONS[kind]} />
    </svg>
  );
  return (
    <span className={cx('btn__icon', kind === 'down' && 'btn__icon--down')}>
      {glyph}
      {glyph}
    </span>
  );
}

export function Button({
  children,
  href,
  variant = 'solid',
  size = 'md',
  icon = 'arrow',
  magnetic = false,
  className,
  ...rest
}: Props) {
  const ref = useRef<HTMLElement | null>(null);

  // The hover fill grows from wherever the pointer entered.
  const onEnter = (e: PointerEvent<HTMLElement>) => {
    const el = e.currentTarget;
    const r = el.getBoundingClientRect();
    el.style.setProperty('--mx', `${e.clientX - r.left}px`);
    el.style.setProperty('--my', `${e.clientY - r.top}px`);
    el.style.setProperty('--fs', String(Math.ceil(Math.hypot(r.width, r.height) * 1.05)));
  };
  const onMove = (e: PointerEvent<HTMLElement>) => {
    if (!magnetic || e.pointerType !== 'mouse') return;
    const el = e.currentTarget;
    const r = el.getBoundingClientRect();
    const dx = e.clientX - (r.left + r.width / 2);
    const dy = e.clientY - (r.top + r.height / 2);
    el.style.transform = `translate(${(dx * 0.16).toFixed(1)}px, ${(dy * 0.28).toFixed(1)}px)`;
  };
  const onLeave = (e: PointerEvent<HTMLElement>) => {
    e.currentTarget.style.transform = '';
  };

  const shared = {
    className: cx('btn', `btn--${variant}`, `btn--${size}`, className),
    onPointerEnter: onEnter,
    onPointerMove: onMove,
    onPointerLeave: onLeave,
  };
  const inner = (
    <>
      <span className="btn__fill" aria-hidden="true" />
      <span className="btn__label">{children}</span>
      {icon !== 'none' && <Icon kind={icon} />}
    </>
  );

  if (href !== undefined) {
    return (
      <a ref={ref as React.RefObject<HTMLAnchorElement>} href={href} {...shared} {...rest}>
        {inner}
      </a>
    );
  }
  return (
    <button ref={ref as React.RefObject<HTMLButtonElement>} type="button" {...shared} {...rest}>
      {inner}
    </button>
  );
}
