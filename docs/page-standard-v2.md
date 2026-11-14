# Account page standard (v2)

Part of issue #239. Version 2 adds `Section`, `Field`, button variants, `EmptyState`, `BackLink`, and one intro sentence per page to the v1 rules.

## Layout
- Every account page starts with `PageHeader` from `apps/web/components/Page.tsx`: the title (the page's only `h1`), one plain-English intro sentence, and an optional row of action buttons. Give every page an intro. Nothing else is styled like a page title.
- A sub-page (no side menu entry) puts `BackLink` above the header, for example `<BackLink href="/account/avatars">Back to avatars</BackLink>`. The label names the parent page.
- The body is a list of `Section` blocks. A `Section` has an `h2`, an optional one-line description (`intro`), and the content. Directly inside `PageMain` it becomes a card. Do not write a bare `h2`, `h3` for a section title, or a loose `section`. Pass `id` when a link points at the section. Use `tone="danger"` for the part of a page that deletes or revokes things.
- Forms that sit directly inside `PageMain` become cards, and forms directly inside a `Section` get the same field spacing.
- Sizes, intro width, and content widths come from the tokens in `apps/web/app/tokens.css` and the base styles in `apps/web/app/globals.css`. Do not set sizes or margins per page.

## Empty states
- When a list or table has no rows, show `EmptyState`: one sentence that says what is missing, and a next action when there is one (`action={{ href, label }}`).

## Forms and buttons
- Use `Field` from `apps/web/components/Field.tsx` for a label, optional hint, the input, an error message, and the required marker. Give the input `fieldProps(prefix, name, error, hintId)` from `apps/web/lib/field-props.ts` (it also works in server pages) so the hint and error are read with it.
- Use `Button` and `ButtonLink` from `apps/web/components/Button.tsx`. Do not write a bare `button` element.
  - `primary` (orange) is the one main action of a form or section.
  - `secondary` (outline) is any other action.
  - `danger` (red) deletes, revokes, removes, unlinks, or signs out everywhere.
- A button's text names its action ("Save profile", "Revoke key", "Delete my BlueyVatar data").

## Names
- The title uses the same words as the side menu label and any link that leads to the page. The menu labels live in `apps/web/lib/account-nav.ts`. `lib/account-nav.test.ts` fails when they differ.
- Owner decisions on #239: the claims page is "Linked accounts", the landing page button is "Set up your avatar", and "Custom profile domain" keeps its name.
- Sub-pages without a menu entry (for example Import an avatar, an organization) name themselves and link back to their parent.

## Copy
- U.S. English, plain words, no em-dashes.
- Tables use `TableBox`, callouts use `Note`.

## Tests
- `lib/account-nav.test.ts` checks that menu labels equal page titles, that every account page uses `PageHeader` with an `intro` and no bare `h1`, `h2`, or `h3`, and that sub-pages use `BackLink`.
- `lib/page-parts.test.ts` checks `Section`, `EmptyState`, `BackLink`, `Field`, and the button variants.
