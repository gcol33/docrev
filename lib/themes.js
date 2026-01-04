/**
 * Slide Themes for Beamer and PPTX
 *
 * 20 professionally designed themes based on modern design principles:
 * - Bold, confident typography (2025-2026 trend)
 * - Curated color palettes (monochrome, earth tones, neo-mint, dark mode)
 * - Clean sans-serif fonts for readability
 * - Consistent visual hierarchy
 *
 * Each theme includes:
 * - Primary, secondary, accent colors
 * - Background and text colors
 * - Font recommendations
 * - Beamer configuration
 */

/**
 * @typedef {Object} Theme
 * @property {string} name - Theme identifier
 * @property {string} displayName - Human-readable name
 * @property {string} description - Theme description
 * @property {Object} colors - Color palette
 * @property {Object} fonts - Font configuration
 * @property {Object} beamer - Beamer-specific settings
 */

export const THEMES = {
  // ============================================
  // MINIMAL & PROFESSIONAL (1-5)
  // ============================================

  metropolis: {
    name: 'metropolis',
    displayName: 'Metropolis',
    description: 'Clean, modern minimal theme inspired by the popular Beamer theme',
    colors: {
      primary: '#23373B',      // Dark teal-gray
      secondary: '#EB811B',    // Orange accent
      accent: '#14B03D',       // Green
      background: '#FAFAFA',   // Off-white
      backgroundDark: '#23373B',
      text: '#23373B',
      textLight: '#FAFAFA',
    },
    fonts: {
      heading: 'Fira Sans',
      body: 'Fira Sans',
      mono: 'Fira Mono',
    },
    beamer: {
      theme: 'metropolis',
      colortheme: null,
      fonttheme: null,
    },
  },

  nordic: {
    name: 'nordic',
    displayName: 'Nordic',
    description: 'Scandinavian-inspired minimal design with soft contrasts',
    colors: {
      primary: '#2E3440',      // Polar Night
      secondary: '#5E81AC',    // Frost blue
      accent: '#88C0D0',       // Aurora cyan
      background: '#ECEFF4',   // Snow
      backgroundDark: '#2E3440',
      text: '#2E3440',
      textLight: '#ECEFF4',
    },
    fonts: {
      heading: 'Inter',
      body: 'Inter',
      mono: 'JetBrains Mono',
    },
    beamer: {
      theme: 'default',
      colortheme: 'dove',
      fonttheme: null,
    },
  },

  slate: {
    name: 'slate',
    displayName: 'Slate',
    description: 'Professional gray tones with subtle blue accent',
    colors: {
      primary: '#334155',      // Slate 700
      secondary: '#64748B',    // Slate 500
      accent: '#3B82F6',       // Blue 500
      background: '#F8FAFC',   // Slate 50
      backgroundDark: '#1E293B',
      text: '#1E293B',
      textLight: '#F1F5F9',
    },
    fonts: {
      heading: 'IBM Plex Sans',
      body: 'IBM Plex Sans',
      mono: 'IBM Plex Mono',
    },
    beamer: {
      theme: 'default',
      colortheme: 'dove',
      fonttheme: null,
    },
  },

  paper: {
    name: 'paper',
    displayName: 'Paper',
    description: 'Warm, academic feel with sepia undertones',
    colors: {
      primary: '#44403C',      // Stone 700
      secondary: '#78716C',    // Stone 500
      accent: '#B45309',       // Amber 700
      background: '#FAFAF9',   // Stone 50
      backgroundDark: '#292524',
      text: '#1C1917',
      textLight: '#FAFAF9',
    },
    fonts: {
      heading: 'Source Sans Pro',
      body: 'Source Serif Pro',
      mono: 'Source Code Pro',
    },
    beamer: {
      theme: 'default',
      colortheme: 'seagull',
      fonttheme: null,
    },
  },

  mono: {
    name: 'mono',
    displayName: 'Mono',
    description: 'Pure black and white for maximum contrast',
    colors: {
      primary: '#000000',
      secondary: '#404040',
      accent: '#000000',
      background: '#FFFFFF',
      backgroundDark: '#000000',
      text: '#000000',
      textLight: '#FFFFFF',
    },
    fonts: {
      heading: 'Helvetica Neue',
      body: 'Helvetica Neue',
      mono: 'Menlo',
    },
    beamer: {
      theme: 'default',
      colortheme: 'dove',
      fonttheme: null,
    },
  },

  // ============================================
  // BOLD & MODERN (6-10)
  // ============================================

  electric: {
    name: 'electric',
    displayName: 'Electric',
    description: 'Bold electric blue monochrome for high-impact presentations',
    colors: {
      primary: '#2563EB',      // Blue 600
      secondary: '#3B82F6',    // Blue 500
      accent: '#60A5FA',       // Blue 400
      background: '#EFF6FF',   // Blue 50
      backgroundDark: '#1E3A8A',
      text: '#1E3A8A',
      textLight: '#EFF6FF',
    },
    fonts: {
      heading: 'Montserrat',
      body: 'Open Sans',
      mono: 'Fira Code',
    },
    beamer: {
      theme: 'default',
      colortheme: 'whale',
      fonttheme: null,
    },
  },

  crimson: {
    name: 'crimson',
    displayName: 'Crimson',
    description: 'Deep red monochrome for bold, confident statements',
    colors: {
      primary: '#DC2626',      // Red 600
      secondary: '#B91C1C',    // Red 700
      accent: '#F87171',       // Red 400
      background: '#FEF2F2',   // Red 50
      backgroundDark: '#7F1D1D',
      text: '#7F1D1D',
      textLight: '#FEF2F2',
    },
    fonts: {
      heading: 'Raleway',
      body: 'Lato',
      mono: 'Roboto Mono',
    },
    beamer: {
      theme: 'default',
      colortheme: 'crane',
      fonttheme: null,
    },
  },

  emerald: {
    name: 'emerald',
    displayName: 'Emerald',
    description: 'Rich green for environmental or growth-focused topics',
    colors: {
      primary: '#059669',      // Emerald 600
      secondary: '#10B981',    // Emerald 500
      accent: '#34D399',       // Emerald 400
      background: '#ECFDF5',   // Emerald 50
      backgroundDark: '#064E3B',
      text: '#064E3B',
      textLight: '#ECFDF5',
    },
    fonts: {
      heading: 'Poppins',
      body: 'Nunito',
      mono: 'Inconsolata',
    },
    beamer: {
      theme: 'default',
      colortheme: 'spruce',
      fonttheme: null,
    },
  },

  violet: {
    name: 'violet',
    displayName: 'Violet',
    description: 'Deep purple for creative and innovative presentations',
    colors: {
      primary: '#7C3AED',      // Violet 600
      secondary: '#8B5CF6',    // Violet 500
      accent: '#A78BFA',       // Violet 400
      background: '#F5F3FF',   // Violet 50
      backgroundDark: '#4C1D95',
      text: '#4C1D95',
      textLight: '#F5F3FF',
    },
    fonts: {
      heading: 'Space Grotesk',
      body: 'DM Sans',
      mono: 'JetBrains Mono',
    },
    beamer: {
      theme: 'default',
      colortheme: 'orchid',
      fonttheme: null,
    },
  },

  amber: {
    name: 'amber',
    displayName: 'Amber',
    description: 'Warm golden tones for engaging, energetic presentations',
    colors: {
      primary: '#D97706',      // Amber 600
      secondary: '#F59E0B',    // Amber 500
      accent: '#FBBF24',       // Amber 400
      background: '#FFFBEB',   // Amber 50
      backgroundDark: '#78350F',
      text: '#78350F',
      textLight: '#FFFBEB',
    },
    fonts: {
      heading: 'Outfit',
      body: 'Work Sans',
      mono: 'Source Code Pro',
    },
    beamer: {
      theme: 'default',
      colortheme: 'beaver',
      fonttheme: null,
    },
  },

  // ============================================
  // DARK MODE (11-14)
  // ============================================

  midnight: {
    name: 'midnight',
    displayName: 'Midnight',
    description: 'Deep dark mode with blue accents',
    colors: {
      primary: '#60A5FA',      // Blue 400
      secondary: '#93C5FD',    // Blue 300
      accent: '#3B82F6',       // Blue 500
      background: '#0F172A',   // Slate 900
      backgroundDark: '#020617',
      text: '#E2E8F0',
      textLight: '#F1F5F9',
    },
    fonts: {
      heading: 'Inter',
      body: 'Inter',
      mono: 'Fira Code',
    },
    beamer: {
      theme: 'default',
      colortheme: 'owl',
      fonttheme: null,
    },
  },

  obsidian: {
    name: 'obsidian',
    displayName: 'Obsidian',
    description: 'Pure dark mode with subtle purple glow',
    colors: {
      primary: '#A78BFA',      // Violet 400
      secondary: '#C4B5FD',    // Violet 300
      accent: '#8B5CF6',       // Violet 500
      background: '#18181B',   // Zinc 900
      backgroundDark: '#09090B',
      text: '#E4E4E7',
      textLight: '#FAFAFA',
    },
    fonts: {
      heading: 'Manrope',
      body: 'Manrope',
      mono: 'JetBrains Mono',
    },
    beamer: {
      theme: 'default',
      colortheme: 'owl',
      fonttheme: null,
    },
  },

  carbon: {
    name: 'carbon',
    displayName: 'Carbon',
    description: 'Tech-forward dark theme with green terminal accent',
    colors: {
      primary: '#4ADE80',      // Green 400
      secondary: '#86EFAC',    // Green 300
      accent: '#22C55E',       // Green 500
      background: '#171717',   // Neutral 900
      backgroundDark: '#0A0A0A',
      text: '#E5E5E5',
      textLight: '#FAFAFA',
    },
    fonts: {
      heading: 'Roboto',
      body: 'Roboto',
      mono: 'Fira Mono',
    },
    beamer: {
      theme: 'default',
      colortheme: 'owl',
      fonttheme: null,
    },
  },

  noir: {
    name: 'noir',
    displayName: 'Noir',
    description: 'Elegant dark mode with warm amber highlights',
    colors: {
      primary: '#FBBF24',      // Amber 400
      secondary: '#FCD34D',    // Amber 300
      accent: '#F59E0B',       // Amber 500
      background: '#1C1917',   // Stone 900
      backgroundDark: '#0C0A09',
      text: '#E7E5E4',
      textLight: '#FAFAF9',
    },
    fonts: {
      heading: 'Playfair Display',
      body: 'Lato',
      mono: 'IBM Plex Mono',
    },
    beamer: {
      theme: 'default',
      colortheme: 'owl',
      fonttheme: null,
    },
  },

  // ============================================
  // EARTH & NATURE (15-17)
  // ============================================

  forest: {
    name: 'forest',
    displayName: 'Forest',
    description: 'Deep greens and earthy browns for natural topics',
    colors: {
      primary: '#166534',      // Green 800
      secondary: '#15803D',    // Green 700
      accent: '#A3E635',       // Lime 400
      background: '#F0FDF4',   // Green 50
      backgroundDark: '#14532D',
      text: '#14532D',
      textLight: '#F0FDF4',
    },
    fonts: {
      heading: 'Josefin Sans',
      body: 'Merriweather Sans',
      mono: 'Inconsolata',
    },
    beamer: {
      theme: 'default',
      colortheme: 'spruce',
      fonttheme: null,
    },
  },

  terracotta: {
    name: 'terracotta',
    displayName: 'Terracotta',
    description: 'Warm earth tones with Mediterranean warmth',
    colors: {
      primary: '#C2410C',      // Orange 700
      secondary: '#EA580C',    // Orange 600
      accent: '#FDBA74',       // Orange 300
      background: '#FFF7ED',   // Orange 50
      backgroundDark: '#7C2D12',
      text: '#7C2D12',
      textLight: '#FFF7ED',
    },
    fonts: {
      heading: 'Cormorant Garamond',
      body: 'Mulish',
      mono: 'Cousine',
    },
    beamer: {
      theme: 'default',
      colortheme: 'beaver',
      fonttheme: null,
    },
  },

  ocean: {
    name: 'ocean',
    displayName: 'Ocean',
    description: 'Deep teal and aqua for marine and water themes',
    colors: {
      primary: '#0D9488',      // Teal 600
      secondary: '#14B8A6',    // Teal 500
      accent: '#5EEAD4',       // Teal 300
      background: '#F0FDFA',   // Teal 50
      backgroundDark: '#134E4A',
      text: '#134E4A',
      textLight: '#F0FDFA',
    },
    fonts: {
      heading: 'Quicksand',
      body: 'Nunito Sans',
      mono: 'Hack',
    },
    beamer: {
      theme: 'default',
      colortheme: 'seahorse',
      fonttheme: null,
    },
  },

  // ============================================
  // CONTEMPORARY & TRENDY (18-20)
  // ============================================

  neomint: {
    name: 'neomint',
    displayName: 'Neo Mint',
    description: '2026 trend: soft futuristic mint with pastel accents',
    colors: {
      primary: '#10B981',      // Emerald 500
      secondary: '#6EE7B7',    // Emerald 300
      accent: '#F472B6',       // Pink 400
      background: '#F0FDF4',   // Green 50
      backgroundDark: '#064E3B',
      text: '#064E3B',
      textLight: '#ECFDF5',
    },
    fonts: {
      heading: 'Plus Jakarta Sans',
      body: 'Plus Jakarta Sans',
      mono: 'Space Mono',
    },
    beamer: {
      theme: 'default',
      colortheme: 'default',
      fonttheme: null,
    },
  },

  gradient: {
    name: 'gradient',
    displayName: 'Gradient',
    description: 'Modern gradient-inspired with pink to purple flow',
    colors: {
      primary: '#EC4899',      // Pink 500
      secondary: '#8B5CF6',    // Violet 500
      accent: '#06B6D4',       // Cyan 500
      background: '#FDF4FF',   // Fuchsia 50
      backgroundDark: '#701A75',
      text: '#701A75',
      textLight: '#FDF4FF',
    },
    fonts: {
      heading: 'Sora',
      body: 'Outfit',
      mono: 'Cascadia Code',
    },
    beamer: {
      theme: 'default',
      colortheme: 'orchid',
      fonttheme: null,
    },
  },

  bauhaus: {
    name: 'bauhaus',
    displayName: 'Bauhaus',
    description: 'Geometric, primary colors inspired by Bauhaus design',
    colors: {
      primary: '#1D4ED8',      // Blue 700
      secondary: '#DC2626',    // Red 600
      accent: '#FACC15',       // Yellow 400
      background: '#FAFAFA',   // Neutral 50
      backgroundDark: '#1E293B',
      text: '#0F172A',
      textLight: '#F8FAFC',
    },
    fonts: {
      heading: 'Archivo',
      body: 'Rubik',
      mono: 'Overpass Mono',
    },
    beamer: {
      theme: 'default',
      colortheme: 'default',
      fonttheme: null,
    },
  },
};

/**
 * Get theme by name
 * @param {string} name - Theme name
 * @returns {Theme|null}
 */
export function getTheme(name) {
  return THEMES[name] || null;
}

/**
 * Get all theme names
 * @returns {string[]}
 */
export function getThemeNames() {
  return Object.keys(THEMES);
}

/**
 * Get themes by category
 * @param {string} category - 'minimal', 'bold', 'dark', 'earth', 'trendy'
 * @returns {Theme[]}
 */
export function getThemesByCategory(category) {
  const categories = {
    minimal: ['metropolis', 'nordic', 'slate', 'paper', 'mono'],
    bold: ['electric', 'crimson', 'emerald', 'violet', 'amber'],
    dark: ['midnight', 'obsidian', 'carbon', 'noir'],
    earth: ['forest', 'terracotta', 'ocean'],
    trendy: ['neomint', 'gradient', 'bauhaus'],
  };

  const names = categories[category] || [];
  return names.map(name => THEMES[name]).filter(Boolean);
}

/**
 * Generate Beamer color definitions for a theme
 * @param {Theme} theme
 * @returns {string} LaTeX color definitions
 */
export function generateBeamerColors(theme) {
  const { colors } = theme;

  // Convert hex to RGB
  const hexToRgb = (hex) => {
    const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
    return result ? {
      r: parseInt(result[1], 16),
      g: parseInt(result[2], 16),
      b: parseInt(result[3], 16),
    } : { r: 0, g: 0, b: 0 };
  };

  const primary = hexToRgb(colors.primary);
  const secondary = hexToRgb(colors.secondary);
  const accent = hexToRgb(colors.accent);
  const bg = hexToRgb(colors.background);
  const bgDark = hexToRgb(colors.backgroundDark);
  const text = hexToRgb(colors.text);

  return `
% Theme: ${theme.displayName}
% ${theme.description}
\\definecolor{ThemePrimary}{RGB}{${primary.r},${primary.g},${primary.b}}
\\definecolor{ThemeSecondary}{RGB}{${secondary.r},${secondary.g},${secondary.b}}
\\definecolor{ThemeAccent}{RGB}{${accent.r},${accent.g},${accent.b}}
\\definecolor{ThemeBackground}{RGB}{${bg.r},${bg.g},${bg.b}}
\\definecolor{ThemeBackgroundDark}{RGB}{${bgDark.r},${bgDark.g},${bgDark.b}}
\\definecolor{ThemeText}{RGB}{${text.r},${text.g},${text.b}}

\\setbeamercolor{structure}{fg=ThemePrimary}
\\setbeamercolor{frametitle}{fg=ThemePrimary,bg=ThemeBackground}
\\setbeamercolor{title}{fg=ThemePrimary}
\\setbeamercolor{subtitle}{fg=ThemeSecondary}
\\setbeamercolor{normal text}{fg=ThemeText,bg=ThemeBackground}
\\setbeamercolor{alerted text}{fg=ThemeAccent}
\\setbeamercolor{example text}{fg=ThemeSecondary}
`.trim();
}

/**
 * Generate CSS for PPTX reference doc
 * @param {Theme} theme
 * @returns {string} CSS string
 */
export function generatePptxCSS(theme) {
  const { colors, fonts } = theme;

  return `
/* Theme: ${theme.displayName} */
/* ${theme.description} */

:root {
  --theme-primary: ${colors.primary};
  --theme-secondary: ${colors.secondary};
  --theme-accent: ${colors.accent};
  --theme-background: ${colors.background};
  --theme-background-dark: ${colors.backgroundDark};
  --theme-text: ${colors.text};
  --theme-text-light: ${colors.textLight};

  --font-heading: '${fonts.heading}', sans-serif;
  --font-body: '${fonts.body}', sans-serif;
  --font-mono: '${fonts.mono}', monospace;
}

/* Slide styles */
.dark {
  background-color: var(--theme-background-dark);
  color: var(--theme-text-light);
}

.cover, .thanks, .section {
  background-color: var(--theme-primary);
  color: var(--theme-text-light);
  text-align: center;
}

.accent {
  background-color: var(--theme-accent);
  color: var(--theme-text);
}
`.trim();
}

/**
 * Format theme info for display
 * @param {Theme} theme
 * @returns {string}
 */
export function formatThemeInfo(theme) {
  const lines = [
    `${theme.displayName}`,
    `  ${theme.description}`,
    `  Colors: ${theme.colors.primary} (primary), ${theme.colors.accent} (accent)`,
    `  Fonts: ${theme.fonts.heading} / ${theme.fonts.body}`,
  ];
  return lines.join('\n');
}

/**
 * List all themes with descriptions
 * @returns {string}
 */
export function listThemes() {
  const categories = [
    { name: 'Minimal & Professional', themes: ['metropolis', 'nordic', 'slate', 'paper', 'mono'] },
    { name: 'Bold & Modern', themes: ['electric', 'crimson', 'emerald', 'violet', 'amber'] },
    { name: 'Dark Mode', themes: ['midnight', 'obsidian', 'carbon', 'noir'] },
    { name: 'Earth & Nature', themes: ['forest', 'terracotta', 'ocean'] },
    { name: 'Contemporary', themes: ['neomint', 'gradient', 'bauhaus'] },
  ];

  const lines = [];
  for (const cat of categories) {
    lines.push(`\n${cat.name}:`);
    for (const name of cat.themes) {
      const theme = THEMES[name];
      lines.push(`  ${name.padEnd(12)} - ${theme.description}`);
    }
  }

  return lines.join('\n');
}
