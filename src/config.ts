/** Placeholder destinations — swap for real URLs when the installer and legal pages exist. */
export const LINKS = {
  download: '#get',
  installer: '#',
  telegram: 'https://t.me/algosolver_bot',
  terms: '#',
  privacy: '#',
  refund: '#',
};

export const PLANS: Array<{ id: string; price: number; days: number; popular: boolean }> = [
  { id: 'day', price: 1.49, days: 1, popular: false },
  { id: 'week', price: 4.99, days: 7, popular: true },
  { id: 'pro', price: 9.99, days: 30, popular: false },
];

export const STATS = [
  { value: 98000, suffix: '+', shape: 'dot', units: 980, cols: 70 },
  { value: 1250, suffix: '+', shape: 'tick', units: 1250, cols: 125 },
  { value: 11, suffix: '', shape: 'block', units: 11, cols: 11 },
  { value: 380, suffix: '+', shape: 'spine', units: 38, cols: 38 },
] as const;
