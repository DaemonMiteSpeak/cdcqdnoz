import { useEffect, useState, type RefObject } from 'react';

type InViewOptions = { once?: boolean; margin?: string; threshold?: number };

export function useInView<T extends Element>(ref: RefObject<T | null>, options: InViewOptions = {}) {
  const { once = true, margin = '0px 0px -12% 0px', threshold = 0 } = options;
  const [inView, setInView] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setInView(true);
          if (once) io.disconnect();
        } else if (!once) {
          setInView(false);
        }
      },
      { rootMargin: margin, threshold },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [ref, once, margin, threshold]);

  return inView;
}

/**
 * Scales a headline so its widest line fills the container.
 * Lines are block elements whose first child is an inline-block holding the text.
 * `cap` is any CSS length; the result is `min(fitted, cap)`.
 */
export function fitLines(el: HTMLElement, lineSelector: string, cap: string, fill = 1) {
  el.style.fontSize = '100px';
  const width = el.clientWidth;
  let size = Infinity;
  el.querySelectorAll<HTMLElement>(lineSelector).forEach((line) => {
    const inner = line.firstElementChild as HTMLElement | null;
    if (!inner) return;
    const cs = getComputedStyle(line);
    const avail = (width - parseFloat(cs.marginLeft) - parseFloat(cs.marginRight)) * fill;
    const natural = inner.getBoundingClientRect().width;
    if (natural > 0) size = Math.min(size, (avail / natural) * 100);
  });
  if (!Number.isFinite(size)) {
    el.style.fontSize = '';
    return;
  }
  el.style.fontSize = `min(${size.toFixed(2)}px, ${cap})`;
}

/** Eased count-up that starts when `active` flips on. */
export function useCountUp(target: number, active: boolean, duration = 1800) {
  const [value, setValue] = useState(0);
  useEffect(() => {
    if (!active) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setValue(target);
      return;
    }
    let raf = 0;
    const t0 = performance.now();
    const tick = (now: number) => {
      const p = Math.min(1, (now - t0) / duration);
      setValue(target * (1 - Math.pow(1 - p, 4)));
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, active, duration]);
  return value;
}
