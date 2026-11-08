# BlueyVatar terms and refund wording (DRAFT for counsel review)

**DRAFT for counsel review. Not approved by the owner. Not live.** Nothing in this file is published, linked from the site, or policy. Square brackets mark choices the owner has not made. Counsel should rewrite freely. Version 1.

Source of facts: how billing works today is in `docs/deploy.md` (Stripe billing, Plan changes in the app) and `docs/spec` section 12.1.

## What this draft covers

Subscriptions to Plus ($9 per month) and Business ($49 per month), changing plans, cancelling, refunds, failed payments, and tax. It does not cover privacy, acceptable use, or the content policy, which live elsewhere.

## 1. Plans and prices

1.1 BlueyVatar offers a Free plan, a Plus plan at $9 per month, and a Business plan at $49 per month. Prices are in U.S. dollars and exclude tax.

1.2 Paid plans are monthly subscriptions that renew automatically until cancelled. The renewal date is the same day each month as your first payment [counsel: confirm wording for months that lack that day].

1.3 We may change prices. [Owner decision needed: how much notice, and whether a change applies to current subscribers at their next renewal.]

## 2. Payment and tax

2.1 Payments are handled by Stripe. We do not store your full card number.

2.2 Sales tax or VAT is added where required, based on your billing address.

2.3 If a renewal payment fails, your paid features continue for 7 days after the first failed payment while Stripe retries. If payment still has not succeeded after 7 days, your account returns to Free limits. We never delete your data, avatars, or profile because of a failed payment. [The 7 days is in the code today; the owner has not formally approved it as policy.]

## 3. Changing plans

3.1 **Upgrading (Plus to Business).** The upgrade starts right away. We charge you the difference for the rest of the current billing period at the time you upgrade. Your renewal date stays the same, and from the next renewal you pay the Business price.

3.2 **Downgrading (Business to Plus).** The downgrade takes effect at the end of your current billing period. You keep Business until then. At the start of the next period you move to Plus at the Plus price. You are not charged for the change and you do not receive a credit or refund for the unused part of the Business period.

3.3 You can cancel a scheduled downgrade at any time before the period ends and stay on Business.

3.4 If you cancel your subscription while a downgrade is scheduled, the scheduled downgrade is dropped and your subscription simply ends at the end of the period (see section 4).

3.5 You cannot change plans in the app while a payment has failed, while your subscription is set to end, or if your plan is arranged by contract (Enterprise). Organization plans are changed through the billing portal.

## 4. Cancelling

4.1 You can cancel at any time. Cancelling stops future renewals. Your paid plan continues until the end of the period you already paid for, then your account moves to Free.

4.2 You can undo a cancellation any time before the period ends. After a subscription has ended, you subscribe again as a new purchase.

## 5. Refunds

5.1 [Owner decision needed. Draft position to review:] We do not refund partial billing periods, including when you cancel or downgrade part way through a period.

5.2 [Owner decision needed:] Whether any exceptions apply, for example a charge made in error, a duplicate charge, or a first payment disputed within [number] days. Counsel should say which exceptions the law in the places we sell requires, and whether consumers in some places have a right to cancel or a refund that cannot be limited by these terms.

5.3 Where we agree to a refund, it goes back to the original payment method through Stripe. [Counsel: confirm. Stripe's pages do not say how long a refund takes to appear on a card, so we say nothing about timing here.]

## 6. Open questions for counsel

1. Do the statements in sections 3 and 5 meet the disclosure rules for automatically renewing subscriptions in the places we sell (for example U.S. states with automatic renewal laws, the EU, and the UK)? Does Checkout need to show the terms or a consent checkbox?
2. Is "no refund for partial periods" enforceable and acceptable for consumers in every place we sell, or do we need a cooling-off or statutory-refund clause?
3. Notice we owe before a price change, and what we owe people on an annual or promotional price (none are sold today).
4. Whether a downgrade that takes effect at period end must be confirmed by email, and whether to send a reminder before the period ends.
5. Wording for failed payments: is a 7 day grace period a promise or a courtesy we may change?
6. Governing law, dispute resolution, and who the contracting company is. None of these are drafted here.
7. Tax: whether the amounts shown at the point of sale should be tax inclusive for some places.
