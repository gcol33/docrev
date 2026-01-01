/**
 * JSON Schema validation for rev.yaml configuration
 */

/**
 * JSON Schema for rev.yaml
 */
export const revYamlSchema = {
  $schema: 'http://json-schema.org/draft-07/schema#',
  title: 'rev.yaml configuration',
  description: 'Configuration file for docrev document workflow',
  type: 'object',
  properties: {
    title: {
      type: 'string',
      description: 'Document title',
    },
    version: {
      type: 'string',
      description: 'Document version',
    },
    authors: {
      type: 'array',
      description: 'List of authors',
      items: {
        oneOf: [
          { type: 'string' },
          {
            type: 'object',
            properties: {
              name: { type: 'string' },
              affiliation: { type: 'string' },
              email: { type: 'string', format: 'email' },
              orcid: { type: 'string', pattern: '^\\d{4}-\\d{4}-\\d{4}-\\d{3}[0-9X]$' },
            },
            required: ['name'],
          },
        ],
      },
    },
    sections: {
      type: 'array',
      description: 'Ordered list of section files to include',
      items: { type: 'string', pattern: '.*\\.md$' },
    },
    bibliography: {
      type: 'string',
      description: 'Path to bibliography file (.bib)',
      pattern: '.*\\.bib$',
    },
    csl: {
      type: 'string',
      description: 'Path to CSL citation style file',
    },
    crossref: {
      type: 'object',
      description: 'pandoc-crossref settings',
      properties: {
        figureTitle: { type: 'string', default: 'Figure' },
        tableTitle: { type: 'string', default: 'Table' },
        figPrefix: {
          oneOf: [
            { type: 'string' },
            { type: 'array', items: { type: 'string' }, minItems: 1, maxItems: 2 },
          ],
        },
        tblPrefix: {
          oneOf: [
            { type: 'string' },
            { type: 'array', items: { type: 'string' }, minItems: 1, maxItems: 2 },
          ],
        },
        eqnPrefix: {
          oneOf: [
            { type: 'string' },
            { type: 'array', items: { type: 'string' }, minItems: 1, maxItems: 2 },
          ],
        },
        secPrefix: {
          oneOf: [
            { type: 'string' },
            { type: 'array', items: { type: 'string' }, minItems: 1, maxItems: 2 },
          ],
        },
        linkReferences: { type: 'boolean', default: true },
      },
      additionalProperties: true,
    },
    pdf: {
      type: 'object',
      description: 'PDF output settings',
      properties: {
        template: { type: 'string' },
        documentclass: {
          type: 'string',
          enum: ['article', 'report', 'book', 'memoir', 'scrartcl', 'scrreprt', 'scrbook'],
          default: 'article',
        },
        fontsize: {
          type: 'string',
          pattern: '^\\d{1,2}pt$',
          default: '12pt',
        },
        geometry: { type: 'string', default: 'margin=1in' },
        linestretch: { type: 'number', minimum: 1, maximum: 3, default: 1.5 },
        numbersections: { type: 'boolean', default: false },
        toc: { type: 'boolean', default: false },
        header: { type: 'string' },
        footer: { type: 'string' },
      },
      additionalProperties: true,
    },
    docx: {
      type: 'object',
      description: 'Word output settings',
      properties: {
        reference: { type: 'string', description: 'Reference document for styling' },
        keepComments: { type: 'boolean', default: true },
        toc: { type: 'boolean', default: false },
      },
      additionalProperties: true,
    },
    tex: {
      type: 'object',
      description: 'LaTeX output settings',
      properties: {
        standalone: { type: 'boolean', default: true },
      },
      additionalProperties: true,
    },
  },
  additionalProperties: true,
};

/**
 * Validate a value against a simple schema
 * @param {*} value - Value to validate
 * @param {object} schema - JSON Schema
 * @param {string} path - Current path for error messages
 * @returns {object[]} Array of validation errors
 */
function validateValue(value, schema, path = '') {
  const errors = [];

  // Handle oneOf
  if (schema.oneOf) {
    const validForAny = schema.oneOf.some((subSchema) => {
      const subErrors = validateValue(value, subSchema, path);
      return subErrors.length === 0;
    });
    if (!validForAny) {
      errors.push({
        path,
        message: `Value does not match any allowed type`,
        value,
      });
    }
    return errors;
  }

  // Type check
  if (schema.type) {
    const actualType = Array.isArray(value) ? 'array' : typeof value;
    if (actualType !== schema.type) {
      errors.push({
        path,
        message: `Expected ${schema.type}, got ${actualType}`,
        value,
      });
      return errors; // Stop further validation if type is wrong
    }
  }

  // String validation
  if (schema.type === 'string' && typeof value === 'string') {
    if (schema.pattern) {
      const regex = new RegExp(schema.pattern);
      if (!regex.test(value)) {
        errors.push({
          path,
          message: `Value "${value}" does not match pattern ${schema.pattern}`,
          value,
        });
      }
    }
    if (schema.enum && !schema.enum.includes(value)) {
      errors.push({
        path,
        message: `Value "${value}" must be one of: ${schema.enum.join(', ')}`,
        value,
      });
    }
  }

  // Number validation
  if (schema.type === 'number' && typeof value === 'number') {
    if (schema.minimum !== undefined && value < schema.minimum) {
      errors.push({
        path,
        message: `Value ${value} is less than minimum ${schema.minimum}`,
        value,
      });
    }
    if (schema.maximum !== undefined && value > schema.maximum) {
      errors.push({
        path,
        message: `Value ${value} is greater than maximum ${schema.maximum}`,
        value,
      });
    }
  }

  // Array validation
  if (schema.type === 'array' && Array.isArray(value)) {
    if (schema.minItems !== undefined && value.length < schema.minItems) {
      errors.push({
        path,
        message: `Array must have at least ${schema.minItems} items`,
        value,
      });
    }
    if (schema.maxItems !== undefined && value.length > schema.maxItems) {
      errors.push({
        path,
        message: `Array must have at most ${schema.maxItems} items`,
        value,
      });
    }
    if (schema.items) {
      value.forEach((item, index) => {
        errors.push(...validateValue(item, schema.items, `${path}[${index}]`));
      });
    }
  }

  // Object validation
  if (schema.type === 'object' && typeof value === 'object' && value !== null) {
    if (schema.properties) {
      for (const [key, propSchema] of Object.entries(schema.properties)) {
        if (value[key] !== undefined) {
          errors.push(...validateValue(value[key], propSchema, path ? `${path}.${key}` : key));
        }
      }
    }
    if (schema.required) {
      for (const key of schema.required) {
        if (value[key] === undefined) {
          errors.push({
            path: path ? `${path}.${key}` : key,
            message: `Required property "${key}" is missing`,
            value: undefined,
          });
        }
      }
    }
  }

  return errors;
}

/**
 * Validate rev.yaml configuration
 * @param {object} config - Parsed configuration object
 * @returns {{ valid: boolean, errors: object[], warnings: object[] }}
 */
export function validateConfig(config) {
  const errors = validateValue(config, revYamlSchema);
  const warnings = [];

  // Additional semantic validations
  if (config.sections && config.sections.length === 0) {
    warnings.push({
      path: 'sections',
      message: 'No sections specified - build will auto-detect .md files',
    });
  }

  if (config.bibliography && !config.bibliography.endsWith('.bib')) {
    warnings.push({
      path: 'bibliography',
      message: 'Bibliography file should have .bib extension',
    });
  }

  if (config.pdf?.linestretch && (config.pdf.linestretch < 1 || config.pdf.linestretch > 3)) {
    warnings.push({
      path: 'pdf.linestretch',
      message: 'Line stretch values outside 1-3 range may produce unexpected results',
    });
  }

  // Check for common typos
  const knownKeys = Object.keys(revYamlSchema.properties);
  for (const key of Object.keys(config)) {
    if (key.startsWith('_')) continue; // Internal keys
    if (!knownKeys.includes(key)) {
      // Check for similar keys (possible typos)
      const similar = knownKeys.find(
        (k) => levenshtein(key.toLowerCase(), k.toLowerCase()) <= 2
      );
      if (similar) {
        warnings.push({
          path: key,
          message: `Unknown property "${key}" - did you mean "${similar}"?`,
        });
      }
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}

/**
 * Format validation results for display
 * @param {{ valid: boolean, errors: object[], warnings: object[] }} result
 * @param {object} chalk - Chalk instance for coloring
 * @returns {string}
 */
export function formatValidationResult(result, chalk) {
  const lines = [];

  if (result.errors.length > 0) {
    lines.push(chalk.red('Configuration errors:'));
    for (const error of result.errors) {
      lines.push(chalk.red(`  ✗ ${error.path}: ${error.message}`));
    }
  }

  if (result.warnings.length > 0) {
    if (lines.length > 0) lines.push('');
    lines.push(chalk.yellow('Warnings:'));
    for (const warning of result.warnings) {
      lines.push(chalk.yellow(`  ! ${warning.path}: ${warning.message}`));
    }
  }

  if (result.valid && result.warnings.length === 0) {
    lines.push(chalk.green('✓ Configuration is valid'));
  }

  return lines.join('\n');
}

/**
 * Levenshtein distance for typo detection
 */
function levenshtein(a, b) {
  const matrix = Array(b.length + 1)
    .fill(null)
    .map(() => Array(a.length + 1).fill(null));
  for (let i = 0; i <= a.length; i++) matrix[0][i] = i;
  for (let j = 0; j <= b.length; j++) matrix[j][0] = j;
  for (let j = 1; j <= b.length; j++) {
    for (let i = 1; i <= a.length; i++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      matrix[j][i] = Math.min(
        matrix[j][i - 1] + 1,
        matrix[j - 1][i] + 1,
        matrix[j - 1][i - 1] + cost
      );
    }
  }
  return matrix[b.length][a.length];
}
