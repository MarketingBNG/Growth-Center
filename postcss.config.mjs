// `plugins` must be an object, not the array form the Tailwind docs show — with the
// array form `next dev` returns 500 on every request while `next build` is fine.
const config = {
  plugins: {
    '@tailwindcss/postcss': {},
  },
};

export default config;
