/**
 * JSON Schema validation for rev.yaml configuration
 */
/**
 * Validation error
 */
interface ValidationError {
    path: string;
    message: string;
    value?: unknown;
}
/**
 * Validation warning
 */
interface ValidationWarning {
    path: string;
    message: string;
}
/**
 * Validation result
 */
interface ValidationResult {
    valid: boolean;
    errors: ValidationError[];
    warnings: ValidationWarning[];
}
/**
 * JSON Schema type
 */
interface Schema {
    $schema?: string;
    title?: string;
    description?: string;
    type?: string;
    properties?: Record<string, Schema>;
    required?: string[];
    items?: Schema;
    oneOf?: Schema[];
    enum?: string[];
    pattern?: string;
    format?: string;
    minimum?: number;
    maximum?: number;
    minItems?: number;
    maxItems?: number;
    additionalProperties?: boolean;
    default?: unknown;
}
/**
 * JSON Schema for rev.yaml
 */
export declare const revYamlSchema: Schema;
/**
 * Validate rev.yaml configuration
 */
export declare function validateConfig(config: Record<string, unknown>): ValidationResult;
/**
 * Format validation results for display
 */
export declare function formatValidationResult(result: ValidationResult, chalk: {
    red: (s: string) => string;
    yellow: (s: string) => string;
    green: (s: string) => string;
}): string;
export {};
//# sourceMappingURL=schema.d.ts.map