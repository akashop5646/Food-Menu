import forms from '@tailwindcss/forms';
import containerQueries from '@tailwindcss/container-queries';

/* Helper to create a color value that supports Tailwind opacity modifiers */
function withOpacity(variableName) {
  return `rgb(var(${variableName}) / <alpha-value>)`;
}

/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        "surface-bright": withOpacity("--color-surface-bright"),
        "inverse-primary": withOpacity("--color-inverse-primary"),
        "on-surface": withOpacity("--color-on-surface"),
        "secondary-fixed-dim": withOpacity("--color-secondary-fixed-dim"),
        "inverse-surface": withOpacity("--color-inverse-surface"),
        "tertiary": withOpacity("--color-tertiary"),
        "surface-container-highest": withOpacity("--color-surface-container-highest"),
        "primary": withOpacity("--color-primary"),
        "on-surface-variant": withOpacity("--color-on-surface-variant"),
        "secondary-container": withOpacity("--color-secondary-container"),
        "outline": withOpacity("--color-outline"),
        "secondary-fixed": withOpacity("--color-secondary-fixed"),
        "surface-variant": withOpacity("--color-surface-variant"),
        "tertiary-fixed": withOpacity("--color-tertiary-fixed"),
        "on-secondary-fixed": withOpacity("--color-on-secondary-fixed"),
        "inverse-on-surface": withOpacity("--color-inverse-on-surface"),
        "on-tertiary-fixed-variant": withOpacity("--color-on-tertiary-fixed-variant"),
        "on-secondary-container": withOpacity("--color-on-secondary-container"),
        "primary-fixed-dim": withOpacity("--color-primary-fixed-dim"),
        "on-tertiary": withOpacity("--color-on-tertiary"),
        "tertiary-container": withOpacity("--color-tertiary-container"),
        "outline-variant": withOpacity("--color-outline-variant"),
        "on-primary-container": withOpacity("--color-on-primary-container"),
        "on-secondary": withOpacity("--color-on-secondary"),
        "surface-container-high": withOpacity("--color-surface-container-high"),
        "on-primary-fixed": withOpacity("--color-on-primary-fixed"),
        "error": withOpacity("--color-error"),
        "surface-container": withOpacity("--color-surface-container"),
        "on-background": withOpacity("--color-on-background"),
        "on-error-container": withOpacity("--color-on-error-container"),
        "primary-container": withOpacity("--color-primary-container"),
        "surface-container-lowest": withOpacity("--color-surface-container-lowest"),
        "surface": withOpacity("--color-surface"),
        "on-error": withOpacity("--color-on-error"),
        "error-container": withOpacity("--color-error-container"),
        "on-secondary-fixed-variant": withOpacity("--color-on-secondary-fixed-variant"),
        "surface-dim": withOpacity("--color-surface-dim"),
        "on-tertiary-container": withOpacity("--color-on-tertiary-container"),
        "on-primary-fixed-variant": withOpacity("--color-on-primary-fixed-variant"),
        "on-tertiary-fixed": withOpacity("--color-on-tertiary-fixed"),
        "secondary": withOpacity("--color-secondary"),
        "on-primary": withOpacity("--color-on-primary"),
        "tertiary-fixed-dim": withOpacity("--color-tertiary-fixed-dim"),
        "surface-container-low": withOpacity("--color-surface-container-low"),
        "background": withOpacity("--color-background"),
        "surface-tint": withOpacity("--color-surface-tint"),
        "primary-fixed": withOpacity("--color-primary-fixed"),
      },
      borderRadius: {
        "DEFAULT": "0.25rem",
        "lg": "0.5rem",
        "xl": "0.75rem",
        "full": "9999px"
      },
      spacing: {
        "unit": "8px",
        "container-padding": "24px",
        "margin-mobile": "16px",
        "gutter": "16px",
        "margin-desktop": "40px"
      },
      fontFamily: {
        "label-caps": ["Plus Jakarta Sans"],
        "body-sm": ["Plus Jakarta Sans"],
        "display-lg": ["Plus Jakarta Sans"],
        "title-md": ["Plus Jakarta Sans"],
        "headline-lg-mobile": ["Plus Jakarta Sans"],
        "body-lg": ["Plus Jakarta Sans"],
        "mono-data": ["Plus Jakarta Sans"],
        "headline-lg": ["Plus Jakarta Sans"],
        "price-display": ["Inter"],
        "headline-sm": ["Playfair Display"],
        "body-md": ["Inter"],
        "headline-md": ["Playfair Display"],
        "display-lg-mobile": ["Plus Jakarta Sans"],
      },
      fontSize: {
        "label-caps": ["12px", { "lineHeight": "1.2", "letterSpacing": "0.1em", "fontWeight": "700" }],
        "body-sm": ["14px", { "lineHeight": "1.5", "fontWeight": "400" }],
        "display-lg": ["48px", { "lineHeight": "1.1", "letterSpacing": "-0.02em", "fontWeight": "700" }],
        "display-lg-mobile": ["36px", { "lineHeight": "1.1", "letterSpacing": "-0.02em", "fontWeight": "700" }],
        "title-md": ["20px", { "lineHeight": "1.4", "fontWeight": "600" }],
        "headline-lg-mobile": ["24px", { "lineHeight": "1.2", "fontWeight": "600" }],
        "body-lg": ["16px", { "lineHeight": "1.6", "fontWeight": "400" }],
        "mono-data": ["14px", { "lineHeight": "1.0", "letterSpacing": "0.02em", "fontWeight": "500" }],
        "headline-lg": ["32px", { "lineHeight": "1.2", "letterSpacing": "-0.01em", "fontWeight": "600" }],
        "price-display": ["20px", { lineHeight: "24px", letterSpacing: "0.02em", fontWeight: "500" }],
        "headline-sm": ["24px", { lineHeight: "32px", fontWeight: "600" }],
        "body-md": ["16px", { lineHeight: "24px", fontWeight: "400" }],
        "headline-md": ["32px", { lineHeight: "40px", fontWeight: "600" }],
      }
    }
  },
  plugins: [
    forms,
    containerQueries
  ],
}
