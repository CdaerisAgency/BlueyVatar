import { Button } from '../../../components/Button'
import { useAsBskyAvatar } from './bsky-actions'

/** The "Use as my avatar on <server>" button for one image, named with the person's real home server. A reason replaces the button for R and X images. */
export default function UseAsBskyAvatar({ rkey, blockedReason, server }: { rkey: string; blockedReason: string | null; server: string }) {
  const label = `Use as my avatar on ${server}`
  if (blockedReason) {
    return (
      <div>
        <Button type="button" disabled aria-describedby={`bsky-why-${rkey}`}>
          {label}
        </Button>
        <span id={`bsky-why-${rkey}`}> {blockedReason}</span>
      </div>
    )
  }
  return (
    <form action={useAsBskyAvatar}>
      <input type="hidden" name="rkey" value={rkey} />
      <Button type="submit">{label}</Button>
    </form>
  )
}
