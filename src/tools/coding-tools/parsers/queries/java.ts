import { LanguageQueries, registerQueries } from './index.js';

export const javaQueries: LanguageQueries = {
    symbols: `
        (method_declaration
            name: (identifier) @name.method) @definition.method
            
        (class_declaration
            name: (identifier) @name.class) @definition.class
            
        (interface_declaration
            name: (identifier) @name.interface) @definition.interface
            
        (enum_declaration
            name: (identifier) @name.class) @definition.class
            
        (variable_declarator
            name: (identifier) @name.variable) @definition.variable
    `,
    imports: `
        (import_declaration
            (_) @source) @import
    `,
    references: `
        (identifier) @reference
        (type_identifier) @reference
    `
};

registerQueries('java', javaQueries);
