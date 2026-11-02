/** @type {import('tailwindcss').Config} */
export default {
  content: ['./app/**/*.{js,ts,jsx,tsx}', './components/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      // Client identity sheet v1.0 (YĒKORA). Ocre is for accents and large text only:
      // its contrast against marfil (~3.1:1) and petroleo (~3.4:1) fails WCAG AA for body text.
      colors: {
        petroleo: '#213C41',
        marfil: '#F8F5EE',
        ocre: '#AD843E',
        negro: '#000000',
      },
      fontFamily: {
        // FC 035: basic Latin first, then Latin Extended (the Ē of YĒKORA); each has its own file.
        sans: [
          'var(--font-inter)',
          'var(--font-inter-ext)',
          'system-ui',
          'sans-serif',
        ],
      },
    },
  },
  plugins: [],
};
