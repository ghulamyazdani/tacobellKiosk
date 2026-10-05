/**
 * Where to send the customer when they leave the /customization screen.
 *
 * Historically the router state carried a single binary flag, `direction`,
 * which four separate exits each interpreted inline:
 *
 *     state?.direction === "cart" ? "/cart" : "/menu"
 *
 * — useCustomization.ts (completed), CustomizationPage.tsx (MIAM close button),
 * and ConfirmCustomization.tsx twice (discard / cancel).
 *
 * Two destinations is not enough once customization can be entered from a
 * screen that is neither the menu nor the cart. The pre-cart upsell is exactly
 * that: sending someone forward to the cart when they CANCELLED a customization
 * is wrong — they never added anything and did not ask to move on.
 *
 * `returnPath` carries an explicit destination and takes precedence. When it is
 * absent the original binary behaviour applies unchanged, so every existing
 * caller keeps working.
 */
export interface CustomizationReturnState {
  direction?: string;
  /** Explicit return route. Wins over `direction` when present. */
  returnPath?: string;
}

export const resolveCustomizationReturnPath = (
  state: CustomizationReturnState | null | undefined,
): string => {
  if (state?.returnPath) return state.returnPath;
  return state?.direction === "cart" ? "/cart" : "/menu";
};
