/** Copy for the account pages. Prices are not here. They come from ../pricing.ts. */
export const ACCOUNT_COPY = {
  session: {
    expired: "You are signed in to blueyvatar, but the link to your account's home server needs to be renewed. Sign in again to keep editing.",
    signInAgain: 'Sign in again',
    busy: 'Your account is busy right now. Try again in a moment.',
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
  sections: {
    title: 'Show on my public profile',
    help: 'Uncheck a section to hide it. A hidden section is removed from your public page, your profile JSON, and your Markdown, vCard, and JSON downloads, including your own view of your public page. Hidden sections disappear from your public profile right away and from other sites within about 5 minutes. Turn a section back on here at any time.',
    show: {
      links: 'Show my links on my public profile',
      languages: 'Show my languages on my public profile',
      wallets: 'Show my wallets on my public profile (each wallet also needs its own show setting)',
      interests: 'Show my interests on my public profile',
      gallery: 'Show my gallery on my public profile',
      verifiedAccounts: 'Show my linked accounts on my public profile',
    },
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
