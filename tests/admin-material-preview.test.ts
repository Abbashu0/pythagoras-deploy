import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import {
  getNativeMaterialCenterFillScale,
  getNativeMaterialCardHeight,
  getNativeMaterialDisplayScale,
  getNativeMaterialFallbackColor,
  getNativeMaterialImageTransform,
  getNativeMaterialPointerOffsets,
  getNativeMaterialTextBottom,
  NativeMaterialCardPreview,
  NATIVE_MATERIAL_LOGICAL_CARD_WIDTH,
  NATIVE_MATERIAL_LOGICAL_DEVICE_WIDTH,
} from "../src/components/admin/materials/material-student-preview";

test("Native Material preview uses the fixed iPhone logical frame", () => {
  assert.equal(NATIVE_MATERIAL_LOGICAL_DEVICE_WIDTH, 440);
  assert.equal(NATIVE_MATERIAL_LOGICAL_CARD_WIDTH, 404);
  assert.equal(getNativeMaterialCardHeight(213), 213);
  assert.equal(getNativeMaterialCardHeight(120), 160);
  assert.equal(getNativeMaterialCardHeight(400), 340);
});

test("Native Material preview mirrors fallback, image, and text formulas", () => {
  assert.equal(
    getNativeMaterialFallbackColor("linear-gradient(135deg, #1a5c3a, #0d3a24)"),
    "#1a5c3a",
  );
  assert.equal(getNativeMaterialFallbackColor("linear-gradient(135deg, oklch(58% 0.13 230))"), null);

  const imageTransform = getNativeMaterialImageTransform(
    { offsetX: 10, offsetY: -25, scale: 0 },
    404,
    213,
  );
  assert.ok(Math.abs(imageTransform.translateX - 40.4) < 1e-9);
  assert.equal(imageTransform.translateY, -53.25);
  assert.equal(imageTransform.scale, 1);
  assert.equal(getNativeMaterialTextBottom(50), 60);
});

test("the shared preview keeps the Arabic and English student titles together", () => {
  const markup = renderToStaticMarkup(createElement(NativeMaterialCardPreview, {
    material: {
      id: "islamic",
      label: "التربية الإسلامية",
      englishTitle: "ISLAMIC",
      gradient: "linear-gradient(135deg, #1a5c3a, #0d3a24)",
      asset: null,
      available: true,
      offsetX: 0,
      offsetY: 0,
      scale: 1,
    },
    settings: {
      fadeIntensity: 0.72,
      textVerticalPosition: 50,
      textScale: 0.9,
      cardHeight: 160,
    },
  }));

  assert.match(markup, /التربية الإسلامية/);
  assert.match(markup, /ISLAMIC/);
  assert.doesNotMatch(markup, /MATERIAL/);
  assert.match(markup, /line-height:1.3/);

  const fallbackMarkup = renderToStaticMarkup(createElement(NativeMaterialCardPreview, {
    material: {
      id: "arabic",
      label: "اللغة العربية",
      englishTitle: "ARABIC",
      gradient: "linear-gradient(135deg, #8b4513, #5c2e0a)",
      asset: null,
      available: true,
      offsetX: 0,
      offsetY: 0,
      scale: 1,
    },
    settings: {
      fadeIntensity: 0.72,
      textVerticalPosition: 50,
      textScale: 0.9,
      cardHeight: 160,
    },
  }));
  assert.match(fallbackMarkup, /اللغة العربية/);
  assert.match(fallbackMarkup, /ARABIC/);
});

test("Auto Position computes center-fill scale without inventing offsets", () => {
  const scale = getNativeMaterialCenterFillScale({
    sourceWidth: 1376,
    sourceHeight: 768,
    frameWidth: 404,
    frameHeight: 160,
  });

  assert.ok(scale !== null);
  assert.ok(Math.abs(scale - (404 / (1376 * (160 / 768)))) < 1e-9);
  assert.equal(
    getNativeMaterialCenterFillScale({
      sourceWidth: 404,
      sourceHeight: 160,
      frameWidth: 404,
      frameHeight: 160,
    }),
    1,
  );
  assert.equal(
    getNativeMaterialCenterFillScale({
      sourceWidth: 0,
      sourceHeight: 768,
      frameWidth: 404,
      frameHeight: 160,
    }),
    null,
  );
});

test("artwork drag converts displayed movement back to the final card frame", () => {
  assert.equal(getNativeMaterialDisplayScale(202), 0.5);
  assert.deepEqual(
    getNativeMaterialPointerOffsets({
      startOffsetX: 0,
      startOffsetY: 0,
      displayedDeltaX: 20,
      displayedDeltaY: 20,
      displayScale: 0.5,
      frameHeight: 160,
    }),
    { offsetX: (40 / 404) * 100, offsetY: (40 / 160) * 100 },
  );
});
