/** Optional, cancellable navigation check. No guard means existing behavior is unchanged. */
export function allowAdminNavigation(href: string): boolean {
  return window.dispatchEvent(new CustomEvent("pythagoras:admin-navigation", { cancelable: true, detail: { href } }));
}
