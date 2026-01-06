/**
 * Tests for PPTX theme system
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import * as fs from 'fs';
import {
  PPTX_THEMES,
  getThemeNames,
  getTheme,
  getThemePath,
} from '../lib/pptx-themes.js';

describe('pptx-themes.js', () => {
  describe('PPTX_THEMES', () => {
    it('should have 6 themes', () => {
      assert.strictEqual(Object.keys(PPTX_THEMES).length, 6);
    });

    it('should have required theme names', () => {
      assert.ok(PPTX_THEMES.default);
      assert.ok(PPTX_THEMES.dark);
      assert.ok(PPTX_THEMES.academic);
      assert.ok(PPTX_THEMES.minimal);
      assert.ok(PPTX_THEMES.corporate);
      assert.ok(PPTX_THEMES.plant);
    });

    it('should have colors and fonts for each theme', () => {
      for (const [name, theme] of Object.entries(PPTX_THEMES)) {
        assert.ok(theme.colors, `${name} should have colors`);
        assert.ok(theme.fonts, `${name} should have fonts`);
        assert.ok(theme.colors.dk1, `${name} should have dk1 color`);
        assert.ok(theme.colors.lt1, `${name} should have lt1 color`);
        assert.ok(theme.colors.accent1, `${name} should have accent1 color`);
        assert.ok(theme.fonts.major, `${name} should have major font`);
        assert.ok(theme.fonts.minor, `${name} should have minor font`);
      }
    });
  });

  describe('getThemeNames', () => {
    it('should return array of 6 theme names', () => {
      const names = getThemeNames();
      assert.ok(Array.isArray(names));
      assert.strictEqual(names.length, 6);
    });

    it('should include all expected names', () => {
      const names = getThemeNames();
      assert.ok(names.includes('default'));
      assert.ok(names.includes('dark'));
      assert.ok(names.includes('academic'));
      assert.ok(names.includes('minimal'));
      assert.ok(names.includes('corporate'));
      assert.ok(names.includes('plant'));
    });
  });

  describe('getTheme', () => {
    it('should return theme object for valid name', () => {
      const theme = getTheme('default');
      assert.ok(theme);
      assert.ok(theme.name);
      assert.ok(theme.colors);
    });

    it('should return null for invalid name', () => {
      const theme = getTheme('nonexistent');
      assert.strictEqual(theme, null);
    });
  });

  describe('getThemePath', () => {
    it('should return path for valid theme', () => {
      const path = getThemePath('default');
      assert.ok(path);
      assert.ok(path.endsWith('.pptx'));
    });

    it('should return null for invalid theme', () => {
      const path = getThemePath('nonexistent');
      assert.strictEqual(path, null);
    });

    it('should return existing file path', () => {
      const path = getThemePath('corporate');
      assert.ok(fs.existsSync(path), `Theme file should exist: ${path}`);
    });

    it('should return valid PPTX file (zip format)', () => {
      const path = getThemePath('default');
      const buffer = fs.readFileSync(path);
      // PPTX files are ZIP files, which start with PK (0x504B)
      assert.strictEqual(buffer[0], 0x50, 'Should start with P');
      assert.strictEqual(buffer[1], 0x4B, 'Should have K as second byte');
    });
  });

  describe('theme distinctiveness', () => {
    it('dark theme should have dark background', () => {
      const theme = getTheme('dark');
      assert.ok(theme.background, 'Dark theme should have background color');
      // Background should be dark (low RGB values)
      const bg = theme.background;
      const r = parseInt(bg.slice(0, 2), 16);
      const g = parseInt(bg.slice(2, 4), 16);
      const b = parseInt(bg.slice(4, 6), 16);
      const brightness = (r + g + b) / 3;
      assert.ok(brightness < 100, 'Dark background should have low brightness');
    });

    it('minimal theme should use black and white', () => {
      const theme = getTheme('minimal');
      assert.strictEqual(theme.colors.dk1, '000000');
      assert.strictEqual(theme.colors.lt1, 'FFFFFF');
    });

    it('academic theme should use serif fonts', () => {
      const theme = getTheme('academic');
      // Georgia and Palatino are serif fonts
      assert.ok(
        theme.fonts.major.includes('Georgia') ||
        theme.fonts.minor.includes('Palatino'),
        'Academic theme should use serif fonts'
      );
    });
  });
});
