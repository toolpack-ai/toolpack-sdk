import { ParsingContext } from './parsing-context.js';
import { ParserFactory } from './parser-factory.js';
import { FileIndex } from './file-index.js';

export const sharedParsingContext = new ParsingContext();
export const sharedParserFactory = new ParserFactory(sharedParsingContext);
export const sharedFileIndex = new FileIndex();
