import { Button } from '../../../components/Button'
import type { PushApp } from '../../../lib/push-apps'
import { pushImage } from '../../integrations/actions'

/** The "Push to <app>" button for one image. A reason replaces the button for R and X images. */
export default function UsePushAvatar({ rkey, app, blockedReason }: { rkey: string; app: PushApp; blockedReason: string | null }) {
  const label = `Push to ${app.name}`
  if (blockedReason) {
    return (
      <div>
        <Button type="button" disabled aria-describedby={`push-why-${app.id}-${rkey}`}>
          {label}
        </Button>
        <span id={`push-why-${app.id}-${rkey}`}> {blockedReason}</span>
      </div>
    )
  }
  return (
    <form action={pushImage}>
      <input type="hidden" name="rkey" value={rkey} />
      <input type="hidden" name="app" value={app.id} />
      <input type="hidden" name="from" value="avatars" />
      <Button type="submit">{label}</Button>
    </form>
  )
}
