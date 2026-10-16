// https://docs.expo.dev/guides/using-eslint/
const { defineConfig } = require('eslint/config');
const expoConfig = require('eslint-config-expo/flat');

module.exports = defineConfig([
  expoConfig,
  {
    ignores: ['dist/*', '.expo/*', 'node_modules/*', 'public/vendor/*'],
  },
  {
    rules: {
      // React Native <Text> does not decode HTML entities, so this web-oriented rule would make text worse.
      'react/no-unescaped-entities': 'off',
    },
  },
  {
    // jest.mock() factories must use require().
    files: ['__tests__/**'],
    rules: { '@typescript-eslint/no-require-imports': 'off' },
  },
]);
