/** Copy for the admin settings page. */
export const ADMIN_SETTINGS_COPY = {
  title: 'Site settings',
  intro: 'Limits, image sizes, and who may use profile embeds. Each number shows the value in effect, the built-in default, and the range allowed.',
  footer: 'Changes reach every server within about a minute.',
  billingNote: 'Display and usage alerts only. Not billed yet.',
  profileAccess: {
    legend: 'Who may use profile embeds',
    who: { anonymous: 'Anonymous visitors', free: 'Free plan', plus: 'Plus plan', business: 'Business plan' },
  },
  overLimit: {
    title: 'Over-limit avatar',
    intro: 'Visitors over a limit see this picture instead of a broken image. It is cropped to a square, and PNG, JPEG, and WebP files up to 2 MB are accepted.',
    none: 'No image uploaded. Visitors over a limit get the built-in picture.',
  },
  msg: {
    saved: (n: number) => (n === 0 ? 'Nothing changed.' : `Saved ${n} ${n === 1 ? 'setting' : 'settings'}.`),
    notSaved: 'Nothing was saved. Fix the fields marked below.',
    reset: 'Reset to the default.',
    unknownSetting: 'Unknown setting.',
    noFile: 'Choose an image to upload.',
    uploaded: 'Saved. Visitors over a limit see the new picture within about 5 minutes.',
    removed: 'Removed. Visitors over a limit see the built-in picture within about 5 minutes.',
    badInt: (label: string, min: string, max: string) => `${label}: enter a whole number from ${min} to ${max}.`,
    badField: (label: string) => `${label}: check this value.`,
  },
} as const
