import coreWebVitals from 'eslint-config-next/core-web-vitals';
import typescript from 'eslint-config-next/typescript';

// eslint-config-next ships native flat configs as of 16, so they are imported directly.
// Loading them through @eslint/eslintrc's FlatCompat — which is what this file did while
// the project was on 15 — now crashes with "Converting circular structure to JSON", and
// a crashing linter reports no problems, which reads exactly like a clean run.
//
// next-env.d.ts and lib/generated are written by Next and Prisma — linting generated
// files reports problems nobody can fix in this repo.
const config = [
  { ignores: ['.next/**', 'node_modules/**', 'lib/generated/**', 'next-env.d.ts'] },
  ...coreWebVitals,
  ...typescript,
];

export default config;
