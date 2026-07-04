export function triggerNavRipple(orb) {
  if (!orb) {
    return;
  }

  orb.classList.remove("is-ripple");
  void orb.offsetWidth;
  orb.classList.add("is-ripple");
  orb.addEventListener("animationend", () => orb.classList.remove("is-ripple"), { once: true });
}

export function triggerNavActivation(item) {
  if (!item) {
    return;
  }

  const orb = item.querySelector(".nav-orb");
  document.querySelectorAll(".nav-item").forEach((node) => node.classList.remove("is-reactivating"));
  if (orb) {
    orb.classList.remove("is-ripple");
  }
  void item.offsetWidth;
  item.classList.add("is-reactivating");
  triggerNavRipple(orb);

  const clear = () => item.classList.remove("is-reactivating");
  item.addEventListener("animationend", clear, { once: true });
  setTimeout(clear, 480);
}

export function bindNavigationInteractions(view, onNavigate, resolveNavTarget) {
  document.querySelectorAll(".nav-item[data-nav-to]").forEach((button) => {
    button.addEventListener("click", () => {
      const target = button.getAttribute("data-nav-to");
      const resolvedTarget = resolveNavTarget ? resolveNavTarget(target) : target;

      if (resolvedTarget === view) {
        triggerNavActivation(button);
        return;
      }

      onNavigate(resolvedTarget, button.getAttribute("data-nav-id") || target);
    });
  });

  document.querySelectorAll("[data-nav-to]:not(.nav-item)").forEach((button) => {
    button.addEventListener("click", () => {
      const target = button.getAttribute("data-nav-to");
      if (target) {
        onNavigate(target);
      }
    });
  });
}
