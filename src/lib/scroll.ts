import Lenis from 'lenis';
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';

gsap.registerPlugin(ScrollTrigger);

let lenis: Lenis | null = null;

export const prefersReducedMotion = () =>
  typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/** Lenis drives the scroll position, GSAP's ticker drives Lenis, so both stay on one clock. */
export function initSmoothScroll() {
  if (prefersReducedMotion()) return () => {};
  const instance = new Lenis({ lerp: 0.11, wheelMultiplier: 1 });
  lenis = instance;
  instance.on('scroll', ScrollTrigger.update);
  const tick = (time: number) => instance.raf(time * 1000);
  gsap.ticker.add(tick);
  gsap.ticker.lagSmoothing(0);
  return () => {
    gsap.ticker.remove(tick);
    instance.destroy();
    if (lenis === instance) lenis = null;
  };
}

export function scrollToTarget(target: string | HTMLElement) {
  const el = typeof target === 'string' ? document.querySelector<HTMLElement>(target) : target;
  if (!el) return;
  if (lenis) {
    lenis.start();
    lenis.scrollTo(el, { duration: 1.5, easing: (t) => 1 - Math.pow(1 - t, 4), force: true });
  } else {
    el.scrollIntoView({ behavior: prefersReducedMotion() ? 'auto' : 'smooth' });
  }
}

export function lockScroll(locked: boolean) {
  if (locked) lenis?.stop();
  else lenis?.start();
  document.documentElement.classList.toggle('is-locked', locked);
}

/** Routes in-page anchors through the smooth scroller; `#` placeholders stay put. */
export function bindAnchorLinks() {
  const onClick = (e: MouseEvent) => {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey) return;
    const link = (e.target as Element | null)?.closest<HTMLAnchorElement>('a[href^="#"]');
    if (!link) return;
    const hash = link.getAttribute('href') ?? '';
    e.preventDefault();
    if (hash.length < 2) return;
    const el = document.querySelector<HTMLElement>(hash);
    if (!el) return;
    scrollToTarget(el);
    history.replaceState(null, '', hash);
  };
  document.addEventListener('click', onClick);
  return () => document.removeEventListener('click', onClick);
}

export { gsap, ScrollTrigger };
