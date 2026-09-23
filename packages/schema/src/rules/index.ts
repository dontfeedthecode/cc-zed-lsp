import type { Rule } from '../types.js';
import {
  enumValues,
  booleanValues,
  maxLengths,
  patterns,
  missingDescription,
} from './fieldRules.js';
import {
  requiresSibling,
  modelWithoutFork,
  combinedBudget,
  reservedFolderName,
  nameMatchesDirectory,
} from './crossFieldRules.js';
import { unknownKey, misplacedKey, undocumentedKey, portability } from './keyRules.js';

export const SKILL_RULES: readonly Rule[] = [
  // per-field
  enumValues,
  booleanValues,
  maxLengths,
  patterns,
  missingDescription,
  // cross-field
  requiresSibling,
  modelWithoutFork,
  combinedBudget,
  reservedFolderName,
  nameMatchesDirectory,
  // keys
  unknownKey,
  misplacedKey,
  undocumentedKey,
  portability,
];
