module.exports = {
  parser: 'babel-eslint',
  extends: ['airbnb', 'prettier'],
  globals: {
    __DEV__: true,
  },
  plugins: ['prettier'],
  rules: {
    'no-underscore-dangle': ['error', { allow: ['_id'] }],
    'arrow-parens': 0,
    'import/prefer-default-export': 0,
    'react/forbid-prop-types': 0,
    'jsx-a11y/label-has-for': 0,
    'react/no-danger': 0,
    'react/jsx-filename-extension': [1, { extensions: ['.js', '.jsx'] }],
    'jsx-a11y/href-no-hash': 0,
    'react/jsx-one-expression-per-line': 0,
    'max-len': 0,
    'prefer-destructuring': [
      'error',
      {
        object: true,
      },
    ],
    'no-console': 0,
  },
  settings: {
    'import/core-modules': [
      'oors',
      'oors-cli',
      'oors-config',
      'oors-file-storage',
      'oors-graphql',
      'oors-health',
      'oors-logger',
      'oors-mailer',
      'oors-mongodb',
      'oors-presets',
      'oors-router',
      'oors-sentry',
      'oors-user',
    ],
  },
};
