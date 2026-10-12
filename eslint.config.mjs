import js from '@eslint/js';
import ts from 'typescript-eslint';
import globals from 'globals';

export default [
  { ignores: ['dist/**','server/generated/**','node_modules/**'] },
  { ...js.configs.recommended, files: ['server/**/*.mjs','scripts/**/*.mjs'], languageOptions: { globals: globals.node }, rules: { ...js.configs.recommended.rules, 'no-unused-vars':['error',{argsIgnorePattern:'^_',varsIgnorePattern:'^_',caughtErrorsIgnorePattern:'^_',ignoreRestSiblings:true}], 'no-control-regex':'off' } },
  ...ts.configs.recommended.map(config=>({...config,files:['src/**/*.ts','src/**/*.tsx']})),
  { files:['src/**/*.ts','src/**/*.tsx'], languageOptions:{globals:{...globals.browser,...globals.node}}, rules:{'@typescript-eslint/no-unused-vars':['error',{argsIgnorePattern:'^_',varsIgnorePattern:'^_',caughtErrorsIgnorePattern:'^_',ignoreRestSiblings:true}], '@typescript-eslint/no-explicit-any':'off','no-control-regex':'off'} },
];
