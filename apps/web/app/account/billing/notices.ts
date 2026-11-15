export const NOTICE: Record<string, string> = {
  success: 'Thanks. Your subscription is being set up. This page updates when Stripe confirms the payment, usually within a minute.',
  canceled: 'Checkout was canceled. You were not charged.',
}

export const UNAVAILABLE = 'Billing is not available yet on this deployment, so plan changes are handled by hand. To change your plan now, email support@blueyvatar.com and include your handle.'
export const PLAN_NAME: Record<string, string> = { plus: 'Plus', business: 'Business' }
