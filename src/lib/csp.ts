/**
 * The Content-Security-Policy every response carries.
 *
 * Lives in its own module so it can be tested. The first version of this policy
 * named the two Razorpay hosts anyone would guess — checkout and api — and
 * silently broke every online payment on the site: Razorpay's checkout script
 * pulls its actual bundle from checkout-static-next.razorpay.com, its assets
 * from cdn.razorpay.com, and beacons to lumberjack-metrics.razorpay.com. All
 * three were blocked, so the checkout could not build itself, the customer got
 * an error, and the order sat unpaid where nobody would look for it.
 *
 * A payment gateway is not a place to be clever about host allow-lists. We
 * already trust Razorpay with the money; the wildcard below covers whichever
 * subdomain they move to next, and everything not razorpay.com stays shut.
 */

/**
 * Razorpay's own scripts reach for at least eight subdomains — api, api-dark,
 * cdn, checkout, checkout-static-next, express, lumberjack, lumberjack-cx and
 * lumberjack-metrics — and the list is theirs to change without telling us.
 *
 * Note this pattern does NOT cover the bare razorpay.com, which is listed
 * separately where a redirect could land on it.
 */
const RZP = "https://*.razorpay.com";
const RZP_ROOT = "https://razorpay.com";

export function contentSecurityPolicy(isProduction: boolean): string {
  return [
    "default-src 'self'",
    /*
     * 'unsafe-inline' is still here, and a scanner will flag it.
     *
     * The strong form is a per-request nonce. Next renders seven inline
     * <script> blocks into every page for hydration, and a nonce only reaches
     * them on pages rendered per request — half this site is prerendered at
     * build time, where there is no request to draw one from. Worse, a nonce
     * anywhere in script-src makes browsers IGNORE 'unsafe-inline', so the
     * policy does not degrade: it blocks all seven and the site loads as blank
     * HTML. Measured against a production build, not assumed.
     */
    `script-src 'self' 'unsafe-inline' ${RZP}`,
    "style-src 'self' 'unsafe-inline'",
    // data: for inline SVG icons; blob: for locally previewed menu photos.
    `img-src 'self' data: blob: ${RZP}`,
    `font-src 'self' data: ${RZP}`,
    // Where a script may send data — the directive that limits what an injected
    // one could exfiltrate. Razorpay's telemetry and API both live under it.
    `connect-src 'self' ${RZP}`,
    // The payment modal is an iframe served by Razorpay; nothing else may be framed.
    `frame-src 'self' ${RZP} ${RZP_ROOT}`,
    // Nothing in this app is meant to be embedded anywhere.
    "frame-ancestors 'none'",
    // Flash/Java-era embeds have no use here and are a known XSS vector.
    "object-src 'none'",
    // Stops injected <base> from re-pointing every relative script URL.
    "base-uri 'self'",
    /*
     * A planted form cannot post the customer's details to another origin —
     * except to Razorpay, because card and netbanking authentication is a form
     * submission out to them and, from there, to the bank.
     */
    `form-action 'self' ${RZP} ${RZP_ROOT}`,
    /*
     * Production only.
     *
     * Tells the browser to re-request every subresource over HTTPS. In
     * production that costs nothing — everything is already TLS. In development
     * it is fatal the moment the site is opened on anything but localhost: a
     * phone on the LAN loading http://192.168.1.4:3000 has its CSS and JS
     * upgraded to https://192.168.1.4:3000, where no TLS listener exists, so
     * the page renders as unstyled text. localhost is exempt because browsers
     * already treat it as trustworthy — which is why this looks fine on the
     * development machine and broken on the one device you wanted to test on.
     */
    ...(isProduction ? ["upgrade-insecure-requests"] : []),
  ].join("; ");
}
