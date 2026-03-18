export interface User {
  id: string;
  clerkId: string;
  email: string;
  name: string | null;
  avatarUrl: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface UserSettings {
  userId: string;
  theme: "light" | "dark" | "system";
  defaultModel: string | null;
  notificationsEnabled: boolean;
}
