import {
  INotificationProvider,
  ProjectNotification,
} from "@/services/notifications/types";

export class DesktopNotificationProvider implements INotificationProvider {
  async send(notification: ProjectNotification): Promise<void> {
    const title = `[TechOffice] ${notification.title}`;
    const body = notification.message;

    // Check if running in browser / Electron renderer with Notification API
    if (typeof window !== "undefined" && "Notification" in window) {
      if (Notification.permission === "granted") {
        new Notification(title, { body });
        return;
      } else if (Notification.permission !== "denied") {
        const permission = await Notification.requestPermission();
        if (permission === "granted") {
          new Notification(title, { body });
          return;
        }
      }
    }

    // Fallback in Node/Main thread
    console.log(`[Notification/Desktop] ${title} - ${body}`);
  }
}
