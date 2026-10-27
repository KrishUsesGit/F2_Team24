/**
 * Illustrative packets that run client -> server to show direction and order.
 * They are NOT measured traffic: the bundle contains no packet-level
 * observations. The scene always says so (see NetworkPath's caption).
 * Hidden entirely under the reduced-motion preference.
 */
export function PacketAnimation({ running, hidden }: { running: boolean; hidden: boolean }) {
  return (
    <div className="packets" aria-hidden="true" data-running={running} data-hidden={hidden} data-testid="packets">
      {[0, 1, 2].map((i) => (
        <span key={i} className="packet" style={{ animationDelay: `${-i * 2}s` }} />
      ))}
    </div>
  )
}
