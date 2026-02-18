/**
 * Built-in templates for project scaffolding
 *
 * Used by `rev new` command to create new paper projects
 */
interface TemplateDefinition {
    name: string;
    description: string;
    files: Record<string, string>;
    directories: string[];
}
export declare const TEMPLATES: Record<string, TemplateDefinition>;
/**
 * Get template by name
 */
export declare function getTemplate(name: string): TemplateDefinition | null;
/**
 * List available templates
 */
export declare function listTemplates(): Array<{
    id: string;
    name: string;
    description: string;
}>;
/**
 * Generate a custom template with specified sections
 */
export declare function generateCustomTemplate(sections: string[], baseTemplate?: TemplateDefinition): TemplateDefinition;
export {};
//# sourceMappingURL=templates.d.ts.map