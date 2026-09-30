import { defineConfig } from "oxlint"
import core from "ultracite/oxlint/core"

export default defineConfig({
  extends: [core],
  ignorePatterns: core.ignorePatterns,
  options: {
    typeAware: true,
    typeCheck: true,
  },
  rules: {
    complexity: ["error", 15],
    "max-classes-per-file": "off",
    "max-depth": ["error", { max: 2 }],
    "sort-keys": "off",
    "unicorn/throw-new-error": "off",
  },
})
