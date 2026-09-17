// §6.6's preset, as two constants a server component and a client component can share.
//
// In a .ts file rather than beside the toggle, for a plain reason: the toggle is a client
// component and the page that reads the parameter is a server one, and the test runner
// cannot load a .tsx at all. A shared name that only one of three callers can import is
// three copies of a string waiting to disagree.

/**
 * "Keep the 'hide the numbers' toggle; add a Partner view preset (no owner-level detail).
 * Partners will open this. They should see performance, not individual staff scorecards."
 *
 * A URL parameter rather than a stored preference, deliberately. The preset exists for the
 * moment a laptop is turned round in a meeting, and a setting somebody has to remember to
 * switch back is a setting that leaks an owner scorecard the next time the screen is
 * shared. The link is shareable and the state is visible in the address bar.
 *
 * It is presentation, not access control. Anyone who can reach the page can clear the
 * parameter, and that is the correct strength: the roster is not secret, it is simply not
 * what a partner should be reading over somebody's shoulder. Restriction is what roles
 * are for.
 */
export const PARTNER_PARAM = 'view';
export const PARTNER_VALUE = 'partner';

export const isPartnerView = (params: Record<string, unknown>) =>
  params[PARTNER_PARAM] === PARTNER_VALUE;
