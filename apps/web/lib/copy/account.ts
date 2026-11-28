/** Copy for the account pages. Prices are not here. They come from ../pricing.ts. */
export const ACCOUNT_COPY = {
  session: {
    expired: "You are signed in to blueyvatar, but the link to your account's home server needs to be renewed. Sign in again to keep editing.",
    signInAgain: 'Sign in again',
  },
  keys: {
    websiteKey: 'Website key (read only, safe to put in a web page)',
    serverKey: 'Server key (read only, keeps usage and stays private)',
    forever: 'Forever',
  },
  timezone: {
    label: 'Time zone',
    notSet: 'Not set',
    useCurrent: 'Use my current time zone',
    savedSuffix: 'saved',
    help: 'Pick the zone that matches your clock. Zones that always share the same time are listed once.',
  },
  share: {
    title: 'Share your profile',
    intro: 'These files and the QR code show what visitors can see on your public profile. Wallets appear only when you chose to show them, and they are marked not verified.',
    unavailable: 'Your QR code and downloads are unavailable until your handle can be loaded.',
    pointer: 'Your QR code and downloads are on the overview page.',
  },
  linkedEmails: {
    title: 'Emails that show your avatar',
    intro: 'Websites that use blueyvatar look up your avatar by email. Add every address you use.',
    primary: 'Primary',
    unsavedTitle: 'Linked email (address not saved yet)',
    unsavedHelp: 'Link the same address again to see it here.',
    linkAgain: 'Link again',
    empty: 'No email linked yet. Link one so websites can find your avatar from your address.',
    emptyAction: 'Link an email',
  },
} as const
