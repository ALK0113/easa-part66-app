/** @type {import('tailwindcss').Config} */
// Colores semánticos: se definen como variables CSS en src/index.css.
// `accent` sigue el color de marca de cada escuela (--brand-primary).
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        canvas: 'var(--canvas)',
        surface: 'var(--surface)',
        subtle: 'var(--subtle)',
        ink: 'var(--ink)',
        'ink-soft': 'var(--ink-soft)',
        muted: 'var(--muted)',
        faint: 'var(--faint)',
        line: 'var(--line)',
        'line-strong': 'var(--line-strong)',
        accent: 'var(--accent)',
        'accent-strong': 'var(--accent-strong)',
        'accent-soft': 'var(--accent-soft)',
        success: 'var(--success)',
        'success-soft': 'var(--success-soft)',
        warn: 'var(--warn)',
        'warn-soft': 'var(--warn-soft)',
        danger: 'var(--danger)',
        'danger-soft': 'var(--danger-soft)',
      },
      borderRadius: {
        xl: '14px',
        '2xl': '18px',
      },
      boxShadow: {
        soft: '0 1px 2px rgba(31, 42, 55, 0.04), 0 1px 1px rgba(31, 42, 55, 0.02)',
        lift: '0 8px 24px rgba(31, 42, 55, 0.08)',
      },
    },
  },
  plugins: [],
}
