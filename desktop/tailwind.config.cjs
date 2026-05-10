/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./src/renderer/**/*.{html,tsx,ts}'],
  theme: {
    extend: {
      colors: {
        app: {
          canvas: 'var(--color-canvas)',
          surface: 'var(--color-surface)',
          elevated: 'var(--color-surface-elevated)',
          muted: 'var(--color-surface-subtle)',
          border: 'var(--color-border)',
          accent: 'var(--color-accent)',
          strong: 'var(--color-text-strong)',
          body: 'var(--color-text)',
          mutedText: 'var(--color-text-muted)',
          subtle: 'var(--color-text-soft)'
        }
      },
      fontFamily: {
        sans: ['var(--font-ui)'],
        mono: ['var(--font-mono)']
      },
      boxShadow: {
        xs: 'var(--shadow-xs)',
        sm: 'var(--shadow-sm)',
        md: 'var(--shadow-md)',
        lg: 'var(--shadow-lg)'
      },
      transitionDuration: {
        DEFAULT: '200ms'
      }
    }
  },
  plugins: []
};
