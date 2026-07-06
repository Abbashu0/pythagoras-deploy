import { pageHead } from "../components/PageHeader.js";
import { screens, themeLabels, densityLabels } from "../scripts/data.js";
import { getStoredTheme } from "../scripts/theme.js";
import { getStoredDensity } from "../scripts/density.js";
import { icon } from "../scripts/icons.js";

const DENSITY_OPTIONS = [
  { id: "compact", label: "صغير", hint: "أكثر محتوى في نفس المساحة" },
  { id: "comfortable", label: "قياسي", hint: "التوازن الافتراضي للقراءة" },
  { id: "spacious", label: "كبير", hint: "خطوط أكبر وبطاقات أفسح" },
];

function densitySliderIndex(density) {
  const idx = DENSITY_OPTIONS.findIndex((o) => o.id === density);
  return idx >= 0 ? idx : 1;
}

function densitySliderPct(density) {
  const idx = densitySliderIndex(density);
  // 0% left, 50% middle, 100% right
  return (idx / (DENSITY_OPTIONS.length - 1)) * 100;
}

export function settingsScreen() {
  const theme = document.body.dataset.theme || getStoredTheme();
  const density = getStoredDensity();
  const densityPct = densitySliderPct(density);

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

              <p class="settings-note" data-theme-status style="display:none">الوضع الحالي: ${themeLabels[theme]}</p>

              <div class="appearance-divider" aria-hidden="true"></div>

              <div class="density-block" data-density-block>
                <div class="density-head">
                  <span class="density-title">حجم العرض</span>
                  <span class="density-hint">${DENSITY_OPTIONS[densitySliderIndex(density)].hint}</span>
                </div>

                <div
                  class="density-slider"
                  role="group"
                  aria-label="حجم العرض"
                  data-density-slider
                  style="--density-thumb-pct: ${densityPct}%"
                >
                  <span class="density-letter density-letter-sm" aria-hidden="true">A</span>

                  <div class="density-track-wrap">
                    <div class="density-track" aria-hidden="true"></div>
                    <div class="density-fill" aria-hidden="true"></div>
                    <div class="density-ticks" aria-hidden="true">
                      ${DENSITY_OPTIONS.map((_, i) => `<span class="density-tick ${i === densitySliderIndex(density) ? "is-active" : ""}" data-density-tick="${i}"></span>`).join("")}
                    </div>
                    <div
                      class="density-thumb"
                      aria-hidden="true"
                    ></div>
                  </div>

                  <span class="density-letter density-letter-lg" aria-hidden="true">A</span>

                  <input
                    type="range"
                    min="0"
                    max="${DENSITY_OPTIONS.length - 1}"
                    step="1"
                    value="${densitySliderIndex(density)}"
                    class="density-input"
                    aria-label="حجم العرض"
                    data-density-input
                  />
                </div>

                <div class="density-options" role="radiogroup" aria-label="أحجام العرض">
                  ${DENSITY_OPTIONS.map((opt) => `
                    <button
                      type="button"
                      class="density-option ${density === opt.id ? "is-selected" : ""}"
                      data-density-choice="${opt.id}"
                      aria-pressed="${density === opt.id}"
                      role="radio"
                      aria-checked="${density === opt.id}"
                    >${opt.label}</button>
                  `).join("")}
                </div>

                <p class="settings-note" data-density-status style="display:none">الحجم الحالي: ${densityLabels[density]}</p>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section class="settings-card subtle stagger" style="animation-delay:180ms">
        <h3 class="section-title">قادمًا لاحقًا</h3>
        <p class="settings-text">شدة الحركة، إعدادات الخطوط، والتخصيصات الدراسية.</p>
      </section>
    </div>`;
}
