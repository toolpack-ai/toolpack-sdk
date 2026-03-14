import { LanguageQueries, registerQueries } from './index.js';

export const goQueries: LanguageQueries = {
    symbols: `
        (function_declaration
            name: (identifier) @name.function) @definition.function
            
        (method_declaration
            name: (field_identifier) @name.method) @definition.method
            
        (type_spec
            name: (type_identifier) @name.type) @definition.type
            
        (var_declaration
            (var_spec
                name: (identifier) @name.variable)) @definition.variable
    `,
    imports: `
        (import_declaration
            (import_spec
                name: (package_identifier)? @name
                path: (interpreted_string_literal) @source)) @import
                
        (import_declaration
            (import_spec_list
                (import_spec
                    name: (package_identifier)? @name
                    path: (interpreted_string_literal) @source))) @import
    `,
    references: `
        (identifier) @reference
        (field_identifier) @reference
        (type_identifier) @reference
    `
};

registerQueries('go', goQueries);
