---
name: Serene Heritage
colors:
  surface: '#fbf8fc'
  surface-dim: '#dcd9dd'
  surface-bright: '#fbf8fc'
  surface-container-lowest: '#ffffff'
  surface-container-low: '#f5f3f6'
  surface-container: '#f0edf1'
  surface-container-high: '#eae7eb'
  surface-container-highest: '#e4e1e5'
  on-surface: '#1b1b1e'
  on-surface-variant: '#404944'
  inverse-surface: '#303033'
  inverse-on-surface: '#f3f0f4'
  outline: '#707974'
  outline-variant: '#bfc9c3'
  surface-tint: '#2b6954'
  primary: '#003527'
  on-primary: '#ffffff'
  primary-container: '#064e3b'
  on-primary-container: '#80bea6'
  inverse-primary: '#95d3ba'
  secondary: '#6b5c4c'
  on-secondary: '#ffffff'
  secondary-container: '#f4dfcb'
  on-secondary-container: '#716252'
  tertiary: '#2d2f2c'
  on-tertiary: '#ffffff'
  tertiary-container: '#444542'
  on-tertiary-container: '#b2b2ae'
  error: '#ba1a1a'
  on-error: '#ffffff'
  error-container: '#ffdad6'
  on-error-container: '#93000a'
  primary-fixed: '#b0f0d6'
  primary-fixed-dim: '#95d3ba'
  on-primary-fixed: '#002117'
  on-primary-fixed-variant: '#0b513d'
  secondary-fixed: '#f4dfcb'
  secondary-fixed-dim: '#d7c3b0'
  on-secondary-fixed: '#241a0e'
  on-secondary-fixed-variant: '#524436'
  tertiary-fixed: '#e3e3de'
  tertiary-fixed-dim: '#c7c7c2'
  on-tertiary-fixed: '#1b1c19'
  on-tertiary-fixed-variant: '#464744'
  background: '#fbf8fc'
  on-background: '#1b1b1e'
  surface-variant: '#e4e1e5'
typography:
  headline-lg:
    fontFamily: IBM Plex Sans Arabic
    fontSize: 30px
    fontWeight: '600'
    lineHeight: 42px
  headline-lg-mobile:
    fontFamily: IBM Plex Sans Arabic
    fontSize: 24px
    fontWeight: '600'
    lineHeight: 34px
  headline-md:
    fontFamily: IBM Plex Sans Arabic
    fontSize: 22px
    fontWeight: '500'
    lineHeight: 32px
  body-lg:
    fontFamily: Amiri
    fontSize: 20px
    fontWeight: '400'
    lineHeight: 36px
  body-md:
    fontFamily: Amiri
    fontSize: 18px
    fontWeight: '400'
    lineHeight: 32px
  label-md:
    fontFamily: IBM Plex Sans Arabic
    fontSize: 14px
    fontWeight: '500'
    lineHeight: 20px
    letterSpacing: 0.02em
  label-sm:
    fontFamily: IBM Plex Sans Arabic
    fontSize: 12px
    fontWeight: '400'
    lineHeight: 16px
rounded:
  sm: 0.25rem
  DEFAULT: 0.5rem
  md: 0.75rem
  lg: 1rem
  xl: 1.5rem
  full: 9999px
spacing:
  unit: 4px
  xs: 4px
  sm: 8px
  md: 16px
  lg: 24px
  xl: 40px
  container-max: 1200px
  gutter: 20px
---

## Brand & Style

This design system centers on a "Modern Spiritualist" aesthetic, blending the clarity of high-end minimalism with the warmth of traditional Islamic scholarship. The target audience includes researchers, students, and casual readers seeking a focused, distraction-free environment for deep reading.

The emotional response is one of **tranquility, reverence, and clarity**. By utilizing generous whitespace and a restricted color palette, the UI recedes to allow the sacred and scholarly texts to remain the focal point. The design style is **Minimalist with Tactile accents**, using subtle depth to define interactive elements without cluttering the visual field. All layouts are architected for native **Right-to-Left (RTL)** orientation, ensuring natural eye flow for Arabic script.

## Colors

The palette is inspired by natural manuscripts and traditional architecture:
- **Primary (Deep Emerald):** Used sparingly for primary actions, active states, and signifying significance. It provides a grounded, scholarly feel.
- **Secondary (Warm Sand):** Used for decorative elements, progress indicators, and subtle highlights. It softens the interface.
- **Tertiary (Paper White):** The core background color, designed to reduce eye strain compared to pure white, mimicking high-quality cream-colored paper.
- **Neutral (Charcoal):** Reserved for body text to ensure maximum contrast and legibility against the paper background.

Surface levels are defined by slight shifts in saturation of the "Sand" and "Paper" tones rather than grey scales.

## Typography

Typography is the cornerstone of this design system. We employ a dual-font strategy:
- **Serif (Amiri):** Used for the core reading experience. Its classical proportions and calligraphic roots provide the necessary "soul" for Islamic texts while maintaining high legibility at long lengths.
- **Sans-Serif (IBM Plex Sans Arabic):** Used for functional UI elements, navigation, and metadata. Its systematic nature provides a modern contrast to the serif body text.

**Reading Experience:** Line height for Arabic body text is intentionally generous (1.8x to 2.0x) to accommodate diacritics (Tashkeel) without visual overlapping.

## Layout & Spacing

The layout follows a **Fixed-Fluid hybrid grid** optimized for reading. 
- **Desktop:** A centered 12-column grid with a maximum content width of 1200px. For the reading view, content is narrowed to 8 columns (approx. 700px) to maintain optimal line length.
- **Mobile:** A single-column fluid layout with 20px side margins.
- **RTL Logic:** All spatial logic is flipped. Margins applied to the "left" in LTR are applied to the "right" here. Navigation drawers emerge from the right, and "Next" actions point to the left.

Spacing follows a 4px base unit, emphasizing large gaps (xl) between major sections to reinforce the "Serene" brand pillar.

## Elevation & Depth

Hierarchy is established through **Tonal Layering** and **Ambient Shadows**:
- **Level 0 (Base):** The "Paper White" background.
- **Level 1 (Cards/Surface):** Pure white surfaces with an extremely soft, large-radius shadow (Blur: 20px, Opacity: 4%, Color: Primary Emerald). This creates a "lifted" effect that feels airy rather than heavy.
- **Level 2 (Modals/Popovers):** Uses the same soft shadow but with a slightly deeper "Sand" border (1px) to define boundaries against the base.

Avoid harsh blacks in shadows; always tint shadows with the Primary Emerald to keep the depth feeling organic.

## Shapes

The shape language is **Softly Structured**. 
- Standard components (buttons, input fields) use a 0.5rem (8px) radius.
- Large containers (book cards, reading panels) use 1rem (16px) to appear more welcoming and "organic."
- Interactive states should never use sharp corners, as they conflict with the serene emotional goal.

## Components

- **Reading Cards:** White background, 16px radius, subtle shadow. The book title uses the Primary Emerald in Bold Sans-Serif, while the author uses the Secondary Sand tone.
- **Buttons:** 
  - *Primary:* Solid Emerald with white text. 
  - *Secondary:* Ghost style with an Emerald border and Sand-tinted background on hover.
- **Chips (Category Tags):** Pill-shaped, using a very light tint of the Secondary Sand color (5% opacity) with charcoal text.
- **Input Fields:** Soft Sand borders (1px). Focus state transitions the border to Emerald with a 2px outer "glow" in a transparent Sand tone.
- **Navigation (RTL):** The sidebar or "Library" menu sits on the right. Active items are marked by a vertical Emerald line on the right edge of the menu item.
- **The "Tasbih" Progress Bar:** A thin horizontal bar in Secondary Sand, filling with Primary Emerald as the reader progresses through a book.