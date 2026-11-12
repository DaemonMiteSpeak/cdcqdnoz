# AlgoSolver — landing page

Marketing site for AlgoSolver, a Windows learning companion for the Algoritmika curriculum.
Frontend only: no auth, payments, backend or desktop app.

## Run

```bash
pnpm install
pnpm dev        # http://localhost:5173
pnpm build      # typecheck + production build into dist/
pnpm preview    # serve dist/ on http://localhost:4173
```

## Stack

Vite, React 19, TypeScript, GSAP (ScrollTrigger) and Lenis for scroll, hand-written CSS.
Type: Roboto Flex (display, variable width / optical size), Onest (text), Martian Mono (labels, code).
All three cover Latin, Azerbaijani and Cyrillic.

## Layout

```
src/
  config.ts            placeholder URLs, plans, statistics
  i18n/                AZ / RU / EN dictionaries and provider
  lib/                 smooth scroll, hooks, code highlighter, helpers
  components/          nav, button, shared primitives (reveals, sort divider, intro)
  sections/
    Hero.tsx           headline + live breadth-first-search canvas (pathField.ts)
    showcase/          interactive model of the desktop app
    Stats.tsx          unit-scale statistics
    features/          feature index with redrawing figures
    courses/           module tape and hands-on widgets
    HowItWorks.tsx     scroll-drawn three-step flow
    Pricing.tsx        ticket plans
    Closing.tsx        FAQ, final call to action, footer
```

## Before launch

- `src/config.ts` holds placeholder links for the installer and the legal pages.
- FAQ answers and all showcase data are illustrative copy; confirm them against the real product.
- `?grid` on the URL tints the hero's wall cells, which helps when adjusting the headline.
