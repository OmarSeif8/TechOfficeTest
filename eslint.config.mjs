import nextCoreWebVitals from "eslint-config-next/core-web-vitals";
import nextTypescript from "eslint-config-next/typescript";
import { dirname } from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// TechOffice — Layer Purity Rules (per CONSTITUTION_V1.1_WEB.md §3.3)
// These rules mechanically enforce the platform-agnostic architecture:
// - src/shared/    : pure types only — may NOT import any platform code
// - src/domain/    : pure domain logic — may ONLY import @shared/*, no platform code
// - src/services/  : interfaces + impls — may import @shared, @domain, platform SDKs (but NOT ui)
// - src/infrastructure/: Prisma impls — may import @shared, @domain/repositories, @prisma/client, next/server
// - src/components/: UI — may import @shared, @domain (types only), shadcn, react, next/navigation
// - src/app/       : Next.js App Router — top of stack, may import anything below

const FORBIDDEN_IN_SHARED = [
  "next",
  "react",
  "react-dom",
  "@prisma/client",
  "electron",
  "fs",
  "path",
  "os",
  "child_process",
  // Allow: @services/* (services may use shared types), @infrastructure/* (NO), @domain/* (NO), ui
  "@domain/",
  "@services/",
  "@infrastructure/",
  "@/app/",
  "@/components/",
];

const FORBIDDEN_IN_DOMAIN = [
  "next",
  "react",
  "react-dom",
  "@prisma/client",
  "electron",
  "fs",
  "path",
  "os",
  "child_process",
  "node:",
  // Domain may import @shared/* (allowed) but NOT services/infrastructure/ui
  "@services/",
  "@infrastructure/",
  "@/app/",
  "@/components/",
  "@/lib/db",
];

const FORBIDDEN_IN_COMPONENTS = [
  "@prisma/client",
  "@infrastructure/",
  "@/lib/db",
  "fs",
  "path",
  "electron",
];

function buildPattern(prefixes) {
  // Match imports that start with any of the given prefixes
  // Captures both bare specifiers ("next") and scoped ("next/...")
  return prefixes.map((p) => p.endsWith("/") ? `^${p.replace(/\//g, "\\/")}.*$` : `^${p.replace(/\//g, "\\/")}$|^${p.replace(/\//g, "\\/")}\\/.*$`).join("|");
}

const sharedPattern = buildPattern(FORBIDDEN_IN_SHARED);
const domainPattern = buildPattern(FORBIDDEN_IN_DOMAIN);
const componentsPattern = buildPattern(FORBIDDEN_IN_COMPONENTS);

const eslintConfig = [...nextCoreWebVitals, ...nextTypescript, {
  rules: {
    // TypeScript rules
    "@typescript-eslint/no-explicit-any": "off",
    "@typescript-eslint/no-unused-vars": "off",
    "@typescript-eslint/no-non-null-assertion": "off",
    "@typescript-eslint/ban-ts-comment": "off",
    "@typescript-eslint/prefer-as-const": "off",
    "@typescript-eslint/no-unused-disable-directive": "off",

    // React rules
    "react-hooks/exhaustive-deps": "off",
    "react-hooks/purity": "off",
    "react/no-unescaped-entities": "off",
    "react/display-name": "off",
    "react/prop-types": "off",
    "react-compiler/react-compiler": "off",

    // Next.js rules
    "@next/next/no-img-element": "off",
    "@next/next/no-html-link-for-pages": "off",

    // General JavaScript rules
    "prefer-const": "off",
    "no-unused-vars": "off",
    "no-console": "off",
    "no-debugger": "off",
    "no-empty": "off",
    "no-irregular-whitespace": "off",
    "no-case-declarations": "off",
    "no-fallthrough": "off",
    "no-mixed-spaces-and-tabs": "off",
    "no-redeclare": "off",
    "no-undef": "off",
    "no-unreachable": "off",
    "no-useless-escape": "off",
  },
}, {
  // ─── Layer Purity: src/shared/ ──────────────────────────────────────────
  // Pure types only — nothing platform-specific allowed.
  files: ["src/shared/**/*.{ts,tsx}"],
  rules: {
    "no-restricted-imports": ["error", {
      patterns: [{
        group: FORBIDDEN_IN_SHARED,
        message: "Layer purity violation: src/shared/ may not import platform code, domain, services, infrastructure, or UI. shared/ is the lowest layer — only stdlib types and @shared/* self-references are allowed.",
      }],
    }],
  },
}, {
  // ─── Layer Purity: src/domain/ ───────────────────────────────────────────
  // Pure domain logic — may import only @shared/* and self. No platform, no UI, no infrastructure.
  files: ["src/domain/**/*.{ts,tsx}"],
  rules: {
    "no-restricted-imports": ["error", {
      patterns: [{
        group: FORBIDDEN_IN_DOMAIN,
        message: "Layer purity violation: src/domain/ may only import @shared/* and other @domain/* files. Platform code (next, react, prisma, fs, path, electron), services, infrastructure, and UI are forbidden — this is what makes the domain layer portable across Next.js, Electron, Tauri, and React Native.",
      }],
    }],
  },
}, {
  // ─── Layer Purity: src/components/ ──────────────────────────────────────
  // UI components may import domain TYPES only (no domain logic that touches DB),
  // shadcn/ui, react, next/navigation — but NOT Prisma or infrastructure.
  files: ["src/components/**/*.{ts,tsx}"],
  rules: {
    "no-restricted-imports": ["error", {
      patterns: [{
        group: FORBIDDEN_IN_COMPONENTS,
        message: "Layer purity violation: src/components/ may not import Prisma, infrastructure adapters, or Node.js built-ins. UI components consume domain types only — never the database client.",
      }],
    }],
  },
}, {
  ignores: [
    "node_modules/**",
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    "examples/**",
    "skills/**",
    "docs/**",
    ".codegraph/**",
    "docs/design-systems/**",
  ],
}];

export default eslintConfig;
