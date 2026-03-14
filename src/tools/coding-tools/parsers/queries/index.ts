export interface LanguageQueries {
    symbols?: string;
    imports?: string;
    exports?: string;
    outline?: string;
    references?: string;
}

export const queries: Record<string, LanguageQueries> = {};

export function registerQueries(language: string, langQueries: LanguageQueries) {
    queries[language] = langQueries;
}
