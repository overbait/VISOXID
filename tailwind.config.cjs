module.exports = {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        background: '#f6f8fb',
        surface: '#ffffff',
        border: '#dbe1ea',
        accent: '#2563eb',
        accentSoft: '#dbeafe',
        text: '#0f172a',
        muted: '#64748b',
        warning: '#f59e0b',
        success: '#10b981',
      },
      fontFamily: {
        sans: ['"Inter"', 'system-ui', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'ui-monospace', 'SFMono-Regular', 'monospace'],
      },
      boxShadow: {
        panel: '0px 12px 40px rgba(15, 23, 42, 0.08)',
        inset: 'inset 0 1px 0 rgba(255,255,255,0.6)',
      },
      borderRadius: {
        xl: '1.25rem',
      },
    },
  },
  plugins: [],
};
