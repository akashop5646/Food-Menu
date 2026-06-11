import forms from '@tailwindcss/forms';
import containerQueries from '@tailwindcss/container-queries';

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
        "surface-bright": "#38393d",
        "inverse-primary": "#735c00",
        "on-surface": "#e3e2e7",
        "secondary-fixed-dim": "#c8c6c5",
        "inverse-surface": "#e3e2e7",
        "tertiary": "#cecece",
        "surface-container-highest": "#343539",
        "primary": "#f2ca50",
        "on-surface-variant": "#d0c5af",
        "secondary-container": "#474746",
        "outline": "#99907c",
        "secondary-fixed": "#e5e2e1",
        "surface-variant": "#343539",
        "tertiary-fixed": "#e2e2e2",
        "on-secondary-fixed": "#1c1b1b",
        "inverse-on-surface": "#2f3034",
        "on-tertiary-fixed-variant": "#474747",
        "on-secondary-container": "#b7b5b4",
        "primary-fixed-dim": "#e9c349",
        "on-tertiary": "#303030",
        "tertiary-container": "#b3b3b3",
        "outline-variant": "#4d4635",
        "on-primary-container": "#554300",
        "on-secondary": "#313030",
        "surface-container-high": "#292a2e",
        "on-primary-fixed": "#241a00",
        "error": "#ffb4ab",
        "surface-container": "#1e1f23",
        "on-background": "#e3e2e7",
        "on-error-container": "#ffdad6",
        "primary-container": "#d4af37",
        "surface-container-lowest": "#0d0e12",
        "surface": "#121317",
        "on-error": "#690005",
        "error-container": "#93000a",
        "on-secondary-fixed-variant": "#474746",
        "surface-dim": "#121317",
        "on-tertiary-container": "#454545",
        "on-primary-fixed-variant": "#574500",
        "on-tertiary-fixed": "#1b1b1b",
        "secondary": "#c8c6c5",
        "on-primary": "#3c2f00",
        "tertiary-fixed-dim": "#c6c6c6",
        "surface-container-low": "#1a1b1f",
        "background": "#121317",
        "surface-tint": "#e9c349",
        "primary-fixed": "#ffe088"
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
      },
      fontSize: {
        "label-caps": ["12px", { "lineHeight": "1.2", "letterSpacing": "0.1em", "fontWeight": "700" }],
        "body-sm": ["14px", { "lineHeight": "1.5", "fontWeight": "400" }],
        "display-lg": ["48px", { "lineHeight": "1.1", "letterSpacing": "-0.02em", "fontWeight": "700" }],
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
