import { useState, type FormEvent } from 'react';

export const COUNTRIES = [
  ['', 'Choose…'],
  ['IN', 'India'],
  ['NP', 'Nepal'],
  ['BD', 'Bangladesh'],
  ['LK', 'Sri Lanka'],
  ['GB', 'United Kingdom'],
  ['US', 'United States'],
  ['DE', 'Germany'],
  ['JP', 'Japan'],
] as const;

export function FormDemo() {
  const [submitted, setSubmitted] = useState<Record<string, string> | null>(null);
  const onSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    setSubmitted(Object.fromEntries(Array.from(fd.entries()).map(([k, v]) => [k, String(v)])));
  };
  return (
    <div className="mx-auto max-w-3xl">
      <h1 className="text-3xl font-extrabold">Contact form</h1>
      <p className="text-slate-500">Selecting a text field opens the gaze keyboard; a dropdown opens a chooser with large tiles.</p>
      <form className="card mt-5 space-y-5" onSubmit={onSubmit}>
        <label className="block">
          <span className="field-label">Name</span>
          <input name="name" className="field mt-1" placeholder="Your name" autoComplete="off" />
        </label>
        <label className="block">
          <span className="field-label">Email</span>
          <input name="email" type="email" className="field mt-1" placeholder="you@example.com" autoComplete="off" />
        </label>
        <label className="block">
          <span className="field-label">Country</span>
          <select name="country" className="field mt-1" data-study-id="country" defaultValue="">
            {COUNTRIES.map(([v, l]) => (
              <option key={v} value={v} disabled={!v}>
                {l}
              </option>
            ))}
          </select>
        </label>
        <fieldset>
          <legend className="field-label">Preferred contact</legend>
          <div className="mt-2 flex flex-wrap gap-3">
            {['Email', 'Phone', 'Post'].map((c) => (
              <label key={c} className="flex cursor-pointer items-center gap-3 rounded-xl px-4 py-3 ring-1 ring-slate-300 has-[:checked]:bg-brand-50 has-[:checked]:ring-brand-500">
                <input type="radio" name="contact" value={c} className="h-5 w-5" data-study-id={`contact-${c}`} /> {c}
              </label>
            ))}
          </div>
        </fieldset>
        <label className="flex cursor-pointer items-center gap-3 rounded-xl px-4 py-3 ring-1 ring-slate-300">
          <input type="checkbox" name="agree" value="yes" className="h-5 w-5" data-study-id="agree" /> I agree to be contacted
        </label>
        <label className="block">
          <span className="field-label">Message</span>
          <textarea name="message" rows={3} className="field mt-1" />
        </label>
        <div className="flex gap-3">
          <button type="submit" className="btn-primary" data-study-id="submit">
            Submit
          </button>
          <button type="reset" className="btn-secondary" onClick={() => setSubmitted(null)}>
            Clear
          </button>
        </div>
      </form>
      {submitted && (
        <pre className="card mt-4 overflow-auto text-sm" role="status" data-testid="form-result">
          {JSON.stringify(submitted, null, 2)}
        </pre>
      )}
    </div>
  );
}
