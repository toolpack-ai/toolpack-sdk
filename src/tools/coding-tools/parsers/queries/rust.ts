import { LanguageQueries, registerQueries } from './index.js';

export const rustQueries: LanguageQueries = {
    symbols: `
        (function_item
            name: (identifier) @name.function) @definition.function
            
        (struct_item
            name: (type_identifier) @name.class) @definition.class
            
        (enum_item
            name: (type_identifier) @name.class) @definition.class
            
        (trait_item
            name: (type_identifier) @name.interface) @definition.interface
            
        (let_declaration
            pattern: (identifier) @name.variable) @definition.variable
    `,
    imports: `
        (use_declaration
            argument: (_) @source) @import
    `,
    references: `
        (identifier) @reference
        (type_identifier) @reference
        (field_identifier) @reference
    `
};

registerQueries('rust', rustQueries);
