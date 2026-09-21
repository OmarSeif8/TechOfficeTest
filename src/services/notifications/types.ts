/**
 * Notification Service Abstraction
 *
 * Dispatches project alerts, overdue submittal warnings, and RFI notifications.
 * Supports Webhook/Email delivery on web, and Native OS notification delivery on desktop.
 */

export type NotificationSeverity = "INFO" | "WARNING" | "CRITICAL";

export interface ProjectNotification {
  id?: string;
  projectId: string;
  title: string;
  message: string;
  severity: NotificationSeverity;
  entityType?: "RFI" | "SUBMITTAL" | "DRAWING" | "PAYMENT" | "SCHEDULE";
  entityId?: string;
  recipientEmail?: string;
  timestamp?: string;
}

export interface INotificationProvider {
  /**
   * Send a notification through the provider's transport mechanism.
   */
  send(notification: ProjectNotification): Promise<void>;
}
