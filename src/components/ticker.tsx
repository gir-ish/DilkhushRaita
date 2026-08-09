/**
 * A painted signboard strip that runs the kitchen's promises past the eye —
 * the web equivalent of the hand-lettered board over a dhaba counter.
 *
 * The track holds the list twice. The animation translates it by exactly -50%,
 * so the moment the first copy leaves the frame the second sits precisely where
 * it started and the loop is seamless at any width. Only the first copy is
 * exposed to assistive tech; the second is decorative duplication.
 */
export function Ticker({ items }: { items: string[] }) {
  const group = (hidden: boolean) => (
    <ul
      className="flex shrink-0 items-center"
      aria-hidden={hidden || undefined}
      // The visible list is the accessible one; screen readers get it as a
      // plain list and never see the scrolling.
      aria-label={hidden ? undefined : "What we promise"}
    >
      {items.map((item) => (
        <li key={item} className="flex items-center whitespace-nowrap">
          <span className="px-6 text-[11px] font-bold uppercase tracking-kicker">{item}</span>
          <span aria-hidden className="text-mustard-300/70 text-[10px]">
            ✦
          </span>
        </li>
      ))}
    </ul>
  );

  return (
    <div className="ticker border-y border-maroon-950/40 bg-gradient-to-b from-maroon-700 to-maroon-800 text-mustard-200 no-print">
      <div className="ticker__track py-2.5">
        {group(false)}
        {group(true)}
      </div>
    </div>
  );
}
