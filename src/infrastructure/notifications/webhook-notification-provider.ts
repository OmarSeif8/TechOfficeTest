import {
  INotificationProvider,
  ProjectNotification,
} from "@/services/notifications/types";

export class WebhookNotificationProvider implements INotificationProvider {
  private webhookUrl: string | undefined;

  constructor(webhookUrl?: string) {
    this.webhookUrl = webhookUrl || process.env.NOTIFICATION_WEBHOOK_URL;
  }

  async send(notification: ProjectNotification): Promise<void> {
    const payload = {
      ...notification,
      timestamp: notification.timestamp || new Date().toISOString(),
    };

    if (!this.webhookUrl) {
      // In development or when webhook is unconfigured, log gracefully
      console.log("[Notification/Webhook] (no webhook URL configured):", payload.title, payload.message);
      return;
    }

    try {
      await fetch(this.webhookUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
    } catch (err) {
      console.error("[Notification/Webhook] Failed to dispatch webhook alert:", err);
    }
  }
}
