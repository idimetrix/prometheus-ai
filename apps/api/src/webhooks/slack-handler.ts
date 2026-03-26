/**
 * Slack Webhook Handler
 *
 * Re-exports the Slack webhook handlers from the routes module.
 * The actual implementation lives in:
 * - apps/api/src/routes/webhooks/slack.ts (events, interactions, actions)
 * - apps/api/src/routes/webhooks/slack-commands.ts (slash commands)
 * - apps/api/src/notifications/slack-notifier.ts (progress notifications)
 *
 * This file is kept for backward compatibility with any code that imports
 * from this path.
 */

export type {
  AgentEventType,
  SlackNotification,
} from "../notifications/slack-notifier";
export {
  notifySlackForTask,
  resolveBotToken,
  sendSlackNotification,
} from "../notifications/slack-notifier";
export { slackWebhookApp } from "../routes/webhooks/slack";
export { slackCommandsApp } from "../routes/webhooks/slack-commands";
