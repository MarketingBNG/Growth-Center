/**
 * The sparkline, rendered on the server.
 *
 * This file used to be a `dynamic(..., { ssr: false })` wrapper like its neighbours, and
 * it carried their twelve-line argument about Recharts: a hundred kilobytes that every
 * screen drawing anything pulled into its first-load bundle. That argument was copied
 * here and was never true of this chart — SparklineImpl draws its own SVG and imports no
 * chart library, so the split deferred nothing and `ssr: false` only moved a stateless
 * component into the client bundle and made its first paint a grey box.
 *
 * SparklineImpl's own header always said it was server-rendered. This file now agrees
 * with it. The re-export keeps the import path its one caller already uses.
 */
export { Sparkline } from './SparklineImpl';
