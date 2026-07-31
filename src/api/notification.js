import {
  countUnreadNotificationsForUser,
  insertNotification,
  listNotificationsForUser,
  markNotificationReadForUser,
} from '../config/loader.js';

export async function sendNotification(env, userID, message, type = 'private') {
  return insertNotification(env, createNotification({ type, message, targetUserID: userID }));
}

export async function broadcastNotification(env, message) {
  return insertNotification(env, createNotification({ type: 'global', message }));
}

export async function sendSystemNotification(env, userID, message) {
  return sendNotification(env, userID, message, 'system');
}

export async function listNotifications(env, userID) {
  return listNotificationsForUser(env, userID);
}

export async function countUnreadNotifications(env, userID) {
  return countUnreadNotificationsForUser(env, userID);
}

export async function markNotificationRead(env, userID, notificationID) {
  return markNotificationReadForUser(env, userID, notificationID);
}

function createNotification({ type, message, targetUserID = '' }) {
  return {
    id: crypto.randomUUID(),
    type,
    message: String(message || ''),
    targetUserID,
    readAt: null,
    createdAt: new Date().toISOString(),
  };
}
