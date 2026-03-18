import type { TechStackPresetExtended } from "./types";

export const REACT_NATIVE_PRESET: TechStackPresetExtended = {
  id: "react-native",
  name: "React Native + Expo",
  description: "Expo SDK 52 + React Native + TypeScript + Supabase",
  languages: ["TypeScript"],
  frameworks: ["Expo", "React Native", "React Navigation", "Supabase"],
  database: "SQLite (local) + Supabase PostgreSQL (cloud)",
  orm: "Drizzle ORM",
  auth: "Supabase Auth",
  testing: ["Jest", "Detox", "Testing Library"],
  deployment: ["EAS Build", "App Store", "Google Play"],
  packageManager: "pnpm",
  linters: ["ESLint", "Prettier"],
  icon: "smartphone",

  dependencies: {
    runtime: {
      expo: "~52.0.0",
      "react-native": "0.76.0",
      "@react-navigation/native": "^7.0.0",
      "@react-navigation/native-stack": "^7.0.0",
      "@supabase/supabase-js": "^2.46.0",
      "@tanstack/react-query": "^5.0.0",
      "expo-router": "~4.0.0",
      "expo-secure-store": "~14.0.0",
      zustand: "^5.0.0",
      "react-native-reanimated": "~3.16.0",
    },
    dev: {
      typescript: "^5.7.0",
      jest: "^29.0.0",
      "@testing-library/react-native": "^12.0.0",
      detox: "^20.0.0",
      eslint: "^9.0.0",
    },
  },

  fileTemplates: {
    "app/_layout.tsx": "Root layout with Supabase provider and React Query",
    "app/(tabs)/_layout.tsx": "Tab navigator with bottom tabs",
    "app/(tabs)/index.tsx": "Home tab screen",
    "app/(auth)/login.tsx": "Login screen with Supabase Auth",
    "src/lib/supabase.ts": "Supabase client initialization with secure storage",
    "src/hooks/useAuth.ts": "Auth hook with Supabase session management",
    "src/components/ui/Button.tsx": "Reusable button component with variants",
  },

  conventions: {
    routing:
      "Expo Router with file-based routing. Auth guard via layout redirect",
    stateManagement:
      "React Query for server state, Zustand for client state, Supabase realtime for live updates",
    apiPattern:
      "Supabase client for database and auth. React Query for caching and mutations",
    componentPattern:
      "Functional components with hooks. NativeWind for Tailwind-like styling",
    styling: "NativeWind (Tailwind CSS for React Native) or StyleSheet.create",
  },

  agentHints: {
    architect:
      "Design with Expo Router file-based routing. Supabase for backend-as-a-service. Offline-first with SQLite.",
    frontend_coder:
      "Write React Native components. Use Expo APIs for device features. NativeWind for styling. React Navigation for deep linking.",
    backend_coder:
      "Use Supabase for database, auth, and storage. Write Row Level Security policies. Edge Functions for custom logic.",
    test_engineer:
      "Jest with Testing Library for component tests. Detox for E2E testing on simulators.",
    deploy_engineer:
      "EAS Build for native builds. EAS Submit for store submission. OTA updates with EAS Update.",
  },
};
