export interface User {
  avatarUrl: string | null;
  clerkId: string;
  createdAt: Date;
  email: string;
  id: string;
  name: string | null;
  updatedAt: Date;
}

export interface UserSettings {
  defaultModel: string | null;
  notificationsEnabled: boolean;
  theme: "light" | "dark" | "system";
  userId: string;
}
