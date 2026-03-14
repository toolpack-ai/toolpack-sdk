import { LanguageQueries, registerQueries } from './index.js';

export const cppQueries: LanguageQueries = {
    symbols: `
        (function_definition
            declarator: (function_declarator
                declarator: (identifier) @name.function)) @definition.function
                
        (class_specifier
            name: (type_identifier) @name.class) @definition.class
            
        (struct_specifier
            name: (type_identifier) @name.class) @definition.class
            
        (declaration
            declarator: (init_declarator
                declarator: (identifier) @name.variable)) @definition.variable
    `,
    imports: `
        (preproc_include
            path: (_) @source) @import
    `,
    references: `
        (identifier) @reference
        (type_identifier) @reference
        (field_identifier) @reference
    `
};

registerQueries('cpp', cppQueries);
registerQueries('c', cppQueries); // Use similar C++ queries for C
