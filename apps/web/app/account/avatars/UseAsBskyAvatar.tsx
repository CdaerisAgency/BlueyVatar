import { Button } from '../../../components/Button'
import { useAsBskyAvatar } from './bsky-actions'

/** The "Use as my Bluesky avatar" button for one image. A reason replaces the button for R and X images. */
export default function UseAsBskyAvatar({ rkey, blockedReason }: { rkey: string; blockedReason: string | null }) {
  if (blockedReason) {
    return (
      <div>
        <Button type="button" disabled aria-describedby={`bsky-why-${rkey}`}>
          Use as my Bluesky avatar
        </Button>
        <span id={`bsky-why-${rkey}`}> {blockedReason}</span>
      </div>
    )
  }
  return (
    <form action={useAsBskyAvatar}>
      <input type="hidden" name="rkey" value={rkey} />
      <Button type="submit">Use as my Bluesky avatar</Button>
    </form>
  )
}
