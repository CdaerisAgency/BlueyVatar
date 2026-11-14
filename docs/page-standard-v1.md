# Account page standard (v1)

Part of issue #239.

## Layout
- Every account page starts with `PageHeader` from `apps/web/components/Page.tsx`: the title (the page's only `h1`), an optional one-sentence intro, and an optional row of action buttons. Nothing else is styled like a page title.
- The page body follows: sections with an `h2`, then content. Forms, lists, and sections directly inside `PageMain` become cards.
- Sizes, intro width, and content widths come from the tokens in `apps/web/app/tokens.css` and the base styles in `apps/web/app/globals.css`. Do not set sizes or margins per page.

## Names
- The title uses the same words as the side menu label and any link that leads to the page. The menu labels live in `apps/web/lib/account-nav.ts`. `lib/account-nav.test.ts` fails when they differ.
- Sub-pages without a menu entry (for example Import an avatar, an organization) name themselves and link back to their parent.

## Copy
- U.S. English, plain words, no em-dashes.
- A button's text names its action ("Save profile", "Revoke key").
- Tables use `TableBox`, callouts use `Note`.
