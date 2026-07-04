import { pageHead } from "../components/PageHeader.js";
import { screens, themeLabels } from "../scripts/data.js";
import { getStoredTheme } from "../scripts/theme.js";
import { icon } from "../scripts/icons.js";

export function settingsScreen() {
  const theme = document.body.dataset.theme || getStoredTheme();

  return `
    ${pageHead(screens.settings)}
    <div class="settings-stack">
      <section class="settings-card appearance-card stagger" style="animation-delay:120ms" data-appearance-card>
        <button
          type="button"
          class="appearance-card-toggle"
          data-appearance-toggle
          aria-expanded="false"
          aria-controls="settings-appearance-panel"
        >
          <span class="appearance-card-leading">
            <span class="icon-wrap featured appearance-card-icon">${icon("sun")}</span>
            <span class="appearance-card-copy">
              <span class="appearance-card-title">مظهر التطبيق</span>
              <span class="appearance-card-description">اختر مظهر القراءة المناسب لك</span>
            </span>
          </span>
          <span class="appearance-card-chevron" aria-hidden="true">${icon("chevron")}</span>
        </button>

        <div class="appearance-card-panel-wrap" id="settings-appearance-panel">
          <div class="appearance-card-panel">
            <div class="appearance-card-panel-inner">
              <p class="appearance-card-note">التغيير يُطبّق فورًا ويُبقي التجربة هادئة وواضحة.</p>

              <div class="theme-preview-device ${theme === "light" ? "is-light" : theme === "aurora" ? "is-aurora" : "is-dark"}">
                <div class="tpd-bar">
                  <div class="tpd-dot"></div><div class="tpd-dot"></div><div class="tpd-dot"></div>
                </div>
                <div class="tpd-card">
                  <div class="tpd-line long"></div>
                  <div class="tpd-line short"></div>
                </div>
                <div class="tpd-nav">
                  <div class="tpd-orb active"></div>
                  <div class="tpd-orb"></div>
                  <div class="tpd-orb"></div>
                </div>
              </div>

              <div class="theme-switcher" role="group" aria-label="تبديل الثيم">
                <button type="button" class="theme-option ${theme === "dark" ? "is-selected" : ""}" data-theme-choice="dark" aria-pressed="${theme === "dark"}">
                  <span class="theme-swatch dark"></span>
                  <span class="theme-option-copy">
                    <strong>داكن</strong>
                    <small>هدوء أعلى وتركيز بصري أقوى</small>
                  </span>
                  <span class="theme-check">${theme === "dark" ? icon("check") : ""}</span>
                </button>
                <button type="button" class="theme-option ${theme === "light" ? "is-selected" : ""}" data-theme-choice="light" aria-pressed="${theme === "light"}">
                  <span class="theme-swatch light"></span>
                  <span class="theme-option-copy">
                    <strong>فاتح</strong>
                    <small>سطح أنظف للقراءة اليومية</small>
                  </span>
                  <span class="theme-check">${theme === "light" ? icon("check") : ""}</span>
                </button>
                <button type="button" class="theme-option ${theme === "aurora" ? "is-selected" : ""}" data-theme-choice="aurora" aria-pressed="${theme === "aurora"}">
                  <span class="theme-swatch aurora"></span>
                  <span class="theme-option-copy">
                    <strong>شفق</strong>
                    <small>بنفسج كوني بلمسة وردية مميّزة</small>
                  </span>
                  <span class="theme-check">${theme === "aurora" ? icon("check") : ""}</span>
                </button>
              </div>

              <p class="settings-note" data-theme-status>الوضع الحالي: ${themeLabels[theme]}</p>
            </div>
          </div>
        </div>
      </section>

      <section class="settings-card subtle stagger" style="animation-delay:180ms">
        <h3 class="section-title">قادمًا لاحقًا</h3>
        <p class="settings-text">إعدادات الخطوط، شدة الحركة، والتخصيصات الدراسية.</p>
      </section>
    </div>`;
}
