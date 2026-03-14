import { LanguageQueries, registerQueries } from './index.js';

export const pythonQueries: LanguageQueries = {
    symbols: `
        (function_definition
            name: (identifier) @name.function) @definition.function
            
        (class_definition
            name: (identifier) @name.class) @definition.class
            
        (assignment
            left: (identifier) @name.variable) @definition.variable
    `,
    imports: `
        (import_statement
            name: (dotted_name) @name) @import
            
        (import_from_statement
            module_name: (dotted_name)? @source
            name: (dotted_name) @name) @import
    `,
    references: `
        (identifier) @reference
    `
};

registerQueries('python', pythonQueries);
