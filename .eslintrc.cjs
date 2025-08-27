/* eslint-env node */
module.exports = {
  root: true,
  ignorePatterns: ["dist/**", "coverage/**", "node_modules/**"],
  plugins: ["@typescript-eslint", "import", "unused-imports", "n", "markdown", "jsonc"],
  overrides: [
    {
      files: ["**/*.ts", "**/*.tsx"],
      parser: "@typescript-eslint/parser",
      parserOptions: {
        project: false,
        ecmaVersion: 2022,
        sourceType: "module"
      },
      extends: [
        "eslint:recommended",
        "plugin:@typescript-eslint/recommended",
        "plugin:import/recommended",
        "plugin:import/typescript",
        "plugin:n/recommended",
        "plugin:jsonc/recommended-with-jsonc",
        "plugin:markdown/recommended",
        "eslint-config-prettier"
      ],
      rules: {
        "no-console": ["warn", { "allow": ["warn", "error"] }],
        "import/order": [
          "error",
          {
            "groups": ["builtin", "external", "internal", ["parent", "sibling", "index"]],
            "newlines-between": "always",
            "alphabetize": { "order": "asc", "caseInsensitive": true }
          }
        ],
        "unused-imports/no-unused-imports": "error",
        "@typescript-eslint/consistent-type-imports": ["error", { "prefer": "type-imports" }],
        "@typescript-eslint/no-explicit-any": "warn",
        "@typescript-eslint/no-unused-vars": ["warn", { "argsIgnorePattern": "^_", "varsIgnorePattern": "^_" }]
      }
    }
  ]
};
