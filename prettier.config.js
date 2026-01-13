module.exports = {
    arrowParens: "avoid",
    bracketSpacing: true,
    jsxBracketSameLine: false,
    jsxSingleQuote: false,
    jsxSingleLine: false,
    printWidth: 150,
    proseWrap: "preserve",
    semi: true,
    singleQuote: false,
    tabWidth: 2,
    trailingComma: "all",
    useTabs: false,
    insertPragma: false,
    overrides: [
      {
        files: "*.mdx",
        options: {
          proseWrap: "always",
        },
      },
    ],
    plugins: ["prettier-plugin-tailwindcss"],
    tailwindConfig: './tailwind.config.ts',
  };