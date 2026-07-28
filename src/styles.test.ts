import { describe, expect, it } from "vitest";
import styles from "./styles.css?raw";

function customProperty(name: string): string {
  const match = styles.match(new RegExp(`${name}:\\s*([^;]+);`));
  if (!match) throw new Error(`Missing CSS custom property ${name}`);
  return match[1].trim();
}

function pixels(name: string): number {
  return Number.parseFloat(customProperty(name));
}

function luminance(hex: string): number {
  const channels = hex
    .match(/[a-f\d]{2}/gi)!
    .map((value) => Number.parseInt(value, 16) / 255)
    .map((value) =>
      value <= 0.04045
        ? value / 12.92
        : ((value + 0.055) / 1.055) ** 2.4
    );
  return (
    0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2]
  );
}

function contrast(foreground: string, background: string): number {
  const values = [luminance(foreground), luminance(background)].sort(
    (left, right) => right - left
  );
  return (values[0] + 0.05) / (values[1] + 0.05);
}

describe("explanation panel accessibility defaults", () => {
  it("keeps the configurable type scale readable", () => {
    expect(pixels("--panel-title-font-size")).toBeGreaterThanOrEqual(20);
    expect(pixels("--panel-lead-font-size")).toBeGreaterThanOrEqual(15);
    expect(pixels("--panel-body-font-size")).toBeGreaterThanOrEqual(14);
    expect(pixels("--panel-small-font-size")).toBeGreaterThanOrEqual(13);
    expect(pixels("--panel-control-font-size")).toBeGreaterThanOrEqual(12);
    expect(pixels("--panel-label-font-size")).toBeGreaterThanOrEqual(11);
  });

  it.each([
    ["--panel-text-strong", "#fbfaf6"],
    ["--panel-text", "#fffefb"],
    ["--panel-text-muted", "#fffefb"],
    ["--panel-text-subtle", "#fbfaf6"],
    ["--panel-accent-text", "#fbf6e9"],
    ["--panel-section-accent", "#fffefb"]
  ])("keeps %s at WCAG AA contrast", (name, background) => {
    expect(contrast(customProperty(name), background)).toBeGreaterThanOrEqual(
      4.5
    );
  });
});
