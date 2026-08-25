import { FlatCompat } from '@eslint/eslintrc';

const compat = new FlatCompat();

// next-env.d.ts and lib/generated are written by Next and Prisma — linting generated
// files reports problems nobody can fix in this repo.
const config = [
  { ignores: ['.next/**', 'node_modules/**', 'lib/generated/**', 'next-env.d.ts'] },
  ...compat.extends('next/core-web-vitals', 'next/typescript'),
];

export default config;
