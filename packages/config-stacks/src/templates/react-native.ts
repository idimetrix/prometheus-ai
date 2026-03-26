import type { ProjectTemplate, ScaffoldFile } from "./types";

function scaffoldFiles(projectName: string): ScaffoldFile[] {
  return [
    {
      path: "package.json",
      content: JSON.stringify(
        {
          name: projectName,
          version: "0.1.0",
          private: true,
          main: "expo-router/entry",
          scripts: {
            dev: "expo start",
            android: "expo run:android",
            ios: "expo run:ios",
            web: "expo start --web",
            lint: "eslint .",
            typecheck: "tsc --noEmit",
            test: "jest",
          },
          dependencies: {
            expo: "~52.0.0",
            "expo-router": "~4.0.0",
            "expo-status-bar": "~2.0.0",
            "expo-secure-store": "~14.0.0",
            react: "^19.0.0",
            "react-native": "0.76.0",
            "react-native-safe-area-context": "^5.0.0",
            "react-native-screens": "^4.0.0",
            "@react-navigation/native": "^7.0.0",
            "@tanstack/react-query": "^5.0.0",
            zustand: "^5.0.0",
          },
          devDependencies: {
            typescript: "^5.7.0",
            "@types/react": "^19.0.0",
            jest: "^29.0.0",
            "@testing-library/react-native": "^12.0.0",
          },
        },
        null,
        2
      ),
    },
    {
      path: "tsconfig.json",
      content: JSON.stringify(
        {
          extends: "expo/tsconfig.base",
          compilerOptions: {
            strict: true,
            paths: { "@/*": ["./*"] },
          },
        },
        null,
        2
      ),
    },
    {
      path: "app.json",
      content: JSON.stringify(
        {
          expo: {
            name: projectName,
            slug: projectName,
            version: "1.0.0",
            scheme: projectName,
            platforms: ["ios", "android"],
            ios: {
              bundleIdentifier: `com.app.${projectName.replace(/-/g, "")}`,
            },
            android: {
              package: `com.app.${projectName.replace(/-/g, "")}`,
            },
            plugins: ["expo-router"],
          },
        },
        null,
        2
      ),
    },
    {
      path: "app/_layout.tsx",
      content: `import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { useState } from "react";

export default function RootLayout() {
  const [queryClient] = useState(() => new QueryClient());

  return (
    <QueryClientProvider client={queryClient}>
      <Stack screenOptions={{ headerShown: true }} />
      <StatusBar style="auto" />
    </QueryClientProvider>
  );
}
`,
    },
    {
      path: "app/index.tsx",
      content: `import { StyleSheet, Text, View } from "react-native";

export default function HomeScreen() {
  return (
    <View style={styles.container}>
      <Text style={styles.title}>${projectName}</Text>
      <Text style={styles.subtitle}>Your React Native app is ready.</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: 24,
  },
  title: {
    fontSize: 32,
    fontWeight: "bold",
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 16,
    color: "#666",
  },
});
`,
    },
    {
      path: "app/(tabs)/_layout.tsx",
      content: `import { Tabs } from "expo-router";

export default function TabLayout() {
  return (
    <Tabs screenOptions={{ headerShown: false }}>
      <Tabs.Screen name="index" options={{ title: "Home" }} />
      <Tabs.Screen name="settings" options={{ title: "Settings" }} />
    </Tabs>
  );
}
`,
    },
    {
      path: "app/(tabs)/index.tsx",
      content: `import { StyleSheet, Text, View } from "react-native";

export default function HomeTab() {
  return (
    <View style={styles.container}>
      <Text style={styles.title}>Home</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: "center", justifyContent: "center" },
  title: { fontSize: 24, fontWeight: "bold" },
});
`,
    },
    {
      path: "app/(tabs)/settings.tsx",
      content: `import { StyleSheet, Text, View } from "react-native";

export default function SettingsTab() {
  return (
    <View style={styles.container}>
      <Text style={styles.title}>Settings</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: "center", justifyContent: "center" },
  title: { fontSize: 24, fontWeight: "bold" },
});
`,
    },
    {
      path: "lib/api.ts",
      content: `const API_BASE = process.env.EXPO_PUBLIC_API_URL ?? "http://localhost:4000";

export async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(\`\${API_BASE}\${path}\`, {
    headers: { "Content-Type": "application/json", ...init?.headers },
    ...init,
  });
  if (!res.ok) {
    throw new Error(\`API error: \${res.status}\`);
  }
  return res.json() as Promise<T>;
}
`,
    },
    {
      path: ".gitignore",
      content: `node_modules/
.expo/
dist/
*.tsbuildinfo
.env
`,
    },
    {
      path: "README.md",
      content: `# ${projectName}

React Native mobile app built with **Expo**, **Expo Router**, and **React Query**.

## Getting Started

\`\`\`bash
pnpm install
pnpm dev         # Start Expo dev server
\`\`\`

Press **i** for iOS simulator, **a** for Android emulator, or scan the QR code with Expo Go.
`,
    },
  ];
}

export const REACT_NATIVE_TEMPLATE: ProjectTemplate = {
  id: "react-native",
  name: "React Native",
  description:
    "Cross-platform mobile app with Expo, Expo Router, React Query, and Zustand state management.",
  category: "Mobile",
  techStack: ["React Native", "Expo", "React Query", "Zustand"],
  languages: ["TypeScript"],
  icon: "smartphone",
  estimatedMinutes: 6,
  scaffoldFiles,
};
