/** The firm's monogram: the US flag running into India's, drawn from the brand kit's
 *  geometry so it stays sharp at sidebar size. */
export function Logo({ className }: { className?: string }) {
  return (
    <svg viewBox="-144 -144 985 985" className={className} aria-hidden="true">
      <g transform="rotate(-45 348 348)">
        <rect x="0" y="0" width="349" height="81" fill="#1A2D86" />
        <rect x="348" y="0" width="349" height="81" fill="#CC1436" />
        <rect x="0" y="123" width="697" height="81" fill="#CC1436" />
        <rect x="0" y="246" width="697" height="81" fill="#CC1436" />
        <rect x="0" y="369" width="697" height="81" fill="#F48420" />
        <rect x="0" y="492" width="697" height="81" fill="#D1D2D4" />
        <rect x="0" y="615" width="697" height="81" fill="#62C940" />
      </g>
    </svg>
  );
}
