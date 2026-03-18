import type { TechStackPresetExtended } from "./types";

export const FLUTTER_PRESET: TechStackPresetExtended = {
  id: "flutter",
  name: "Flutter Cross-Platform",
  description: "Flutter 3 + Dart + Riverpod + Drift + Firebase",
  languages: ["Dart"],
  frameworks: ["Flutter 3", "Riverpod", "Drift", "GoRouter"],
  database: "SQLite (local) + Firestore (cloud)",
  orm: "Drift",
  auth: "Firebase Auth",
  testing: ["flutter_test", "integration_test", "mockito"],
  deployment: ["Google Play", "App Store", "Firebase Hosting"],
  packageManager: "pub",
  linters: ["dart analyze", "custom_lint"],
  icon: "smartphone",

  dependencies: {
    runtime: {
      flutter_riverpod: "^2.6.0",
      riverpod_annotation: "^2.6.0",
      go_router: "^14.6.0",
      drift: "^2.22.0",
      firebase_core: "^3.8.0",
      firebase_auth: "^5.3.0",
      cloud_firestore: "^5.5.0",
      dio: "^5.7.0",
      freezed_annotation: "^2.4.0",
      json_annotation: "^4.9.0",
    },
    dev: {
      build_runner: "^2.4.0",
      drift_dev: "^2.22.0",
      freezed: "^2.5.0",
      json_serializable: "^6.8.0",
      riverpod_generator: "^2.6.0",
      mockito: "^5.4.0",
      flutter_lints: "^5.0.0",
    },
  },

  fileTemplates: {
    "lib/main.dart":
      "App entry point with ProviderScope and MaterialApp.router",
    "lib/core/router/app_router.dart":
      "GoRouter configuration with auth redirect",
    "lib/core/providers/providers.dart": "Global Riverpod providers",
    "lib/features/auth/presentation/login_screen.dart":
      "Login screen with Firebase Auth",
    "lib/features/home/presentation/home_screen.dart":
      "Home screen with bottom navigation",
    "lib/core/database/app_database.dart": "Drift database definition",
    "lib/core/network/api_client.dart": "Dio HTTP client with interceptors",
  },

  conventions: {
    routing: "GoRouter with declarative routing and auth guards",
    stateManagement:
      "Riverpod for all state management. AsyncNotifier for async state",
    apiPattern:
      "Repository pattern with Dio HTTP client. Freezed for immutable data classes",
    componentPattern:
      "Feature-based folder structure. Presentation/domain/data layers per feature",
    styling: "Material Design 3 theme. Custom ThemeData with ColorScheme",
  },

  agentHints: {
    architect:
      "Design with feature-based architecture. Use Riverpod for dependency injection. Drift for local persistence. Firebase for auth and cloud sync.",
    frontend_coder:
      "Write Flutter widgets with Riverpod consumers. Use GoRouter for navigation. Material 3 theming.",
    backend_coder:
      "Implement repositories with Drift DAOs. Firebase Firestore rules for security. Dio interceptors for API auth.",
    test_engineer:
      "Widget tests with flutter_test. Riverpod testing with ProviderContainer. Integration tests on real devices.",
    deploy_engineer:
      "Fastlane for iOS/Android build automation. Firebase App Distribution for testing. GitHub Actions for CI.",
  },
};
