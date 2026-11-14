import { useState } from 'react';

const PRODUCTS = [
  { id: 'tea', name: 'Assam tea, 250 g', price: 240, color: 'bg-amber-100' },
  { id: 'mug', name: 'Ceramic mug', price: 320, color: 'bg-sky-100' },
  { id: 'lamp', name: 'Reading lamp', price: 1450, color: 'bg-yellow-100' },
  { id: 'bag', name: 'Canvas tote bag', price: 499, color: 'bg-emerald-100' },
  { id: 'notebook', name: 'Dot-grid notebook', price: 180, color: 'bg-rose-100' },
  { id: 'plant', name: 'Desk plant', price: 650, color: 'bg-lime-100' },
];

export function ShopDemo() {
  const [cart, setCart] = useState<Record<string, number>>({});
  const [liked, setLiked] = useState<Set<string>>(new Set());
  const [paid, setPaid] = useState<number | null>(null);
  const add = (id: string, d: number) =>
    setCart((c) => {
      const n = Math.max(0, (c[id] ?? 0) + d);
      const next = { ...c, [id]: n };
      if (!n) delete next[id];
      return next;
    });
  const total = Object.entries(cart).reduce((s, [id, q]) => s + q * PRODUCTS.find((p) => p.id === id)!.price, 0);
  return (
    <div className="mx-auto grid max-w-6xl gap-6 lg:grid-cols-[2fr_1fr]">
      <div>
        <h1 className="text-3xl font-extrabold">Corner Shop</h1>
        <p className="text-slate-500">Cards with several buttons each. “Remove” and “Pay” ask for confirmation first.</p>
        <div className="mt-5 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {PRODUCTS.map((p) => (
            <article key={p.id} className="card flex flex-col gap-3 p-4">
              <div className={`relative flex h-28 items-center justify-center rounded-xl text-4xl ${p.color}`}>
                <span aria-hidden>🛍️</span>
                <button
                  aria-label={`${liked.has(p.id) ? 'Unlike' : 'Like'} ${p.name}`}
                  onClick={() => setLiked((s) => (s.has(p.id) ? (s.delete(p.id), new Set(s)) : new Set(s.add(p.id))))}
                  className="absolute right-2 top-2 flex h-10 w-10 items-center justify-center rounded-full bg-white text-xl shadow"
                >
                  {liked.has(p.id) ? '♥' : '♡'}
                </button>
              </div>
              <div className="font-bold">{p.name}</div>
              <div className="text-slate-600">₹{p.price}</div>
              <button className="btn-primary mt-auto" onClick={() => add(p.id, 1)} data-ipilot-safe>
                Add to cart
              </button>
            </article>
          ))}
        </div>
      </div>
      <aside className="card h-fit lg:sticky lg:top-24">
        <h2 className="text-xl font-bold">Cart</h2>
        {Object.keys(cart).length === 0 && <p className="mt-2 text-slate-500">Your cart is empty.</p>}
        <ul className="mt-3 space-y-3">
          {Object.entries(cart).map(([id, q]) => {
            const p = PRODUCTS.find((x) => x.id === id)!;
            return (
              <li key={id} className="flex items-center gap-2">
                <span className="flex-1 font-medium">{p.name}</span>
                <button aria-label={`One less ${p.name}`} className="h-10 w-10 rounded-lg bg-slate-100 text-xl font-bold" onClick={() => add(id, -1)}>
                  −
                </button>
                <span className="w-6 text-center font-mono">{q}</span>
                <button aria-label={`One more ${p.name}`} className="h-10 w-10 rounded-lg bg-slate-100 text-xl font-bold" onClick={() => add(id, 1)}>
                  +
                </button>
                <button className="rounded-lg px-2 py-2 text-sm font-semibold text-red-600 hover:bg-red-50" onClick={() => add(id, -q)}>
                  Remove
                </button>
              </li>
            );
          })}
        </ul>
        <div className="mt-4 flex justify-between border-t pt-4 text-lg font-bold">
          <span>Total</span>
          <span>₹{total}</span>
        </div>
        <button className="btn-danger mt-4 w-full" disabled={!total} onClick={() => (setPaid(total), setCart({}))}>
          Pay now
        </button>
        {paid !== null && (
          <p className="mt-3 rounded-xl bg-emerald-50 p-3 font-semibold text-emerald-800" role="status">
            Demo payment of ₹{paid} recorded (nothing was charged).
          </p>
        )}
      </aside>
    </div>
  );
}
