const webpush = require('web-push');
const cron = require('node-cron');
const DatabaseHelper = require('../utils/dbHelper');

// The morning-summary job wakes every minute during these hours, so 06:00-10:59 is
// exactly the range a saved preference can ever be delivered in. Anywhere outside it
// is a time that can only be stored and silently never sent, so the API refuses it.
// Both the cron expression and the API validation read these numbers, which is the
// only reason the two can never drift apart.
const MORNING_SUMMARY_FIRST_HOUR = 6;
const MORNING_SUMMARY_LAST_HOUR = 10;
const MORNING_SUMMARY_WINDOW = Object.freeze({
    firstHour: MORNING_SUMMARY_FIRST_HOUR,
    lastHour: MORNING_SUMMARY_LAST_HOUR,
    firstTime: `${String(MORNING_SUMMARY_FIRST_HOUR).padStart(2, '0')}:00`,
    lastTime: `${String(MORNING_SUMMARY_LAST_HOUR).padStart(2, '0')}:59`,
    cron: `* ${MORNING_SUMMARY_FIRST_HOUR}-${MORNING_SUMMARY_LAST_HOUR} * * *`
});

// A push service answers these when the endpoint is gone for good. Anything else is
// somebody having a bad minute, and pruning on that would silently unsubscribe them.
const DEAD_SUBSCRIPTION_STATUS_CODES = new Set([404, 410]);

class NotificationService {
    constructor(db) {
        this.db = db;
        this.dbHelper = new DatabaseHelper(db);
        this.initialized = false;
        this.degradationReason = null;
        this.scheduledJobs = new Map();
        // No init() call here. A constructor cannot fail, so the version that ran
        // one could only ever swallow its own error - see the init() docstring.
    }

    /**
     * Configure VAPID, then start the schedulers.
     *
     * Returns a result rather than logging or throwing. Previously the constructor
     * called this, logged its own failure, and returned - so a missing VAPID key
     * meant the schedulers never started for the life of the process while the
     * caller still printed "Notification service initialized". Reporting is now
     * the caller's job, and every caller must call this and check the result.
     *
     * @returns {Promise<{ok: true} | {ok: false, reason: string}>}
     */
    async init() {
        try {
            // Configure VAPID keys
            webpush.setVapidDetails(
                process.env.VAPID_EMAIL || 'mailto:admin@example.com',
                process.env.VAPID_PUBLIC_KEY,
                process.env.VAPID_PRIVATE_KEY
            );
        } catch (error) {
            this.initialized = false;
            this.degradationReason = error.message;
            return { ok: false, reason: error.message };
        }

        this.initialized = true;
        this.degradationReason = null;
        this.startSchedulers();
        return { ok: true };
    }

    startSchedulers() {
        // Check for upcoming shifts every minute
        const shiftReminderJob = cron.schedule('* * * * *', () => {
            this.checkUpcomingShifts();
        }, {
            scheduled: false
        });

        // Send morning summaries every minute inside the schedulable window
        const morningSummaryJob = cron.schedule(MORNING_SUMMARY_WINDOW.cron, () => {
            this.sendMorningSummaries();
        }, {
            scheduled: false
        });

        this.scheduledJobs.set('shiftReminders', shiftReminderJob);
        this.scheduledJobs.set('morningSummaries', morningSummaryJob);

        // Start all jobs
        shiftReminderJob.start();
        morningSummaryJob.start();

        console.log('📅 Notification schedulers started:');
        console.log('   - Shift reminders: Every minute');
        console.log(`   - Morning summaries: Every minute during ${MORNING_SUMMARY_WINDOW.firstTime}-${MORNING_SUMMARY_WINDOW.lastTime}`);
    }

    async subscribeUser(userId, subscription) {
        try {
            // First, ensure the user has a notification_settings record
            await this.dbHelper.runWithRetry(
                `INSERT OR IGNORE INTO notification_settings (user_id) VALUES (?)`,
                [userId]
            );
            
            // Then update only the push-related fields, preserving other preferences
            await this.dbHelper.runWithRetry(
                `UPDATE notification_settings 
                 SET push_subscription = ?, push_enabled = 1, updated_at = CURRENT_TIMESTAMP
                 WHERE user_id = ?`,
                [JSON.stringify(subscription), userId]
            );

            console.log(`📱 User ${userId} subscribed to push notifications`);
            return true;
        } catch (error) {
            console.error('Error subscribing user to push notifications:', error);
            return false;
        }
    }

    async unsubscribeUser(userId) {
        try {
            await this.dbHelper.runWithRetry(
                'UPDATE notification_settings SET push_enabled = 0, push_subscription = NULL WHERE user_id = ?',
                [userId]
            );

            console.log(`📱 User ${userId} unsubscribed from push notifications`);
            return true;
        } catch (error) {
            console.error('Error unsubscribing user from push notifications:', error);
            return false;
        }
    }

    /**
     * Write only the preferences the caller actually provided.
     *
     * The route validates each field with `!== undefined`, so partial updates are the
     * contract. Filling absent keys with defaults used to overwrite them: saving just
     * the summary time reset a 45-minute reminder to 15 and switched summaries back on
     * for someone who had turned them off.
     */
    async updateNotificationPreferences(userId, preferences = {}) {
        try {
            const writes = [];
            const params = [];

            const write = (column, value) => {
                writes.push(`${column} = ?`);
                params.push(value);
            };

            if (preferences.notificationAdvanceMinutes !== undefined) {
                write('notification_advance_minutes', preferences.notificationAdvanceMinutes);
            }
            if (preferences.morningSummaryEnabled !== undefined) {
                write('morning_summary_enabled', preferences.morningSummaryEnabled ? 1 : 0);
            }
            if (preferences.morningSummaryTime !== undefined) {
                write('morning_summary_time', preferences.morningSummaryTime);
            }

            // Nothing offered, nothing to do. Reporting success without a write keeps
            // the caller honest: no defaults reached the row as a side effect.
            if (writes.length === 0) return true;

            // First, ensure the user has a notification_settings record
            await this.dbHelper.runWithRetry(
                `INSERT OR IGNORE INTO notification_settings (user_id) VALUES (?)`,
                [userId]
            );

            // Then update only the fields that were provided, preserving both the
            // other preferences and the push subscription data on the same row.
            await this.dbHelper.runWithRetry(
                `UPDATE notification_settings 
                 SET ${writes.join(', ')}, updated_at = CURRENT_TIMESTAMP
                 WHERE user_id = ?`,
                [...params, userId]
            );

            return true;
        } catch (error) {
            console.error('Error updating notification preferences:', error);
            return false;
        }
    }

    /**
     * Whether a HH:MM preference can ever be delivered, given the cron it is stored
     * for. Exposed so the API can refuse an unschedulable time instead of accepting
     * it and then never sending anything.
     */
    isSchedulableMorningSummaryTime(morningSummaryTime) {
        const [hours, minutes] = String(morningSummaryTime).split(':').map(Number);
        if (!Number.isInteger(hours) || !Number.isInteger(minutes)) return false;

        const minuteOfDay = hours * 60 + minutes;
        return minuteOfDay >= MORNING_SUMMARY_WINDOW.firstHour * 60 &&
               minuteOfDay <= MORNING_SUMMARY_WINDOW.lastHour * 60 + 59;
    }

    async getNotificationPreferences(userId) {
        try {
            const preferences = await new Promise((resolve, reject) => {
                this.db.get(
                    `SELECT notification_advance_minutes, morning_summary_enabled, 
                     morning_summary_time, push_enabled FROM notification_settings 
                     WHERE user_id = ?`,
                    [userId],
                    (err, row) => {
                        if (err) reject(err);
                        else resolve(row);
                    }
                );
            });

            return preferences || {
                notification_advance_minutes: 15,
                morning_summary_enabled: true,
                morning_summary_time: '07:00',
                push_enabled: false
            };
        } catch (error) {
            console.error('Error getting notification preferences:', error);
            return null;
        }
    }

    async checkUpcomingShifts() {
        if (!this.initialized) return;

        try {
            // Get all users with push notifications enabled
            const users = await new Promise((resolve, reject) => {
                this.db.all(
                    `SELECT ns.user_id, ns.notification_advance_minutes, ns.push_subscription,
                     u.first_name, u.last_name
                     FROM notification_settings ns
                     JOIN users u ON ns.user_id = u.id
                     WHERE ns.push_enabled = 1 AND ns.push_subscription IS NOT NULL`,
                    (err, rows) => {
                        if (err) reject(err);
                        else resolve(rows || []);
                    }
                );
            });

            for (const user of users) {
                await this.checkUserUpcomingShifts(user);
            }
        } catch (error) {
            console.error('Error checking upcoming shifts:', error);
        }
    }

    async checkUserUpcomingShifts(user) {
        try {
            const now = new Date();
            const checkTime = new Date(now.getTime() + (user.notification_advance_minutes * 60 * 1000));
            
            // Use local time for comparison (assignments are stored in local time)
            const checkDate = this.formatLocalDate(checkTime);
            const checkTimeStr = this.formatLocalTime(checkTime);
            
            // Convert 24-hour time to 12-hour format for comparison with database
            const check12Hour = this.formatTo12Hour(checkTimeStr);

            if (process.env.NOTIFICATION_DEBUG === 'true') {
                console.log(`🔍 Checking shifts for ${user.first_name} ${user.last_name}:`);
                console.log(`   Current time (UTC): ${now.toTimeString().slice(0, 5)}`);
                console.log(`   Current time (Local): ${this.formatLocalTime(now)}`);
                console.log(`   Check time (+${user.notification_advance_minutes}min): ${checkTimeStr} / ${check12Hour}`);
                console.log(`   Check date: ${checkDate}`);
            }

            const assignments = await new Promise((resolve, reject) => {
                this.db.all(
                    `SELECT day_date, time_slot FROM assignments 
                     WHERE user_id = ? AND day_date = ? AND (time_slot = ? OR time_slot = ?)`,
                    [user.user_id, checkDate, checkTimeStr, check12Hour],
                    (err, rows) => {
                        if (err) reject(err);
                        else resolve(rows || []);
                    }
                );
            });

            if (process.env.NOTIFICATION_DEBUG === 'true' && assignments.length > 0) {
                console.log(`   Found ${assignments.length} upcoming assignments:`);
                assignments.forEach(a => console.log(`     - ${a.day_date} at ${a.time_slot}`));
            }

            for (const assignment of assignments) {
                await this.sendShiftReminder(user, assignment);
            }
        } catch (error) {
            console.error(`Error checking shifts for user ${user.user_id}:`, error);
        }
    }

    formatTo12Hour(time24) {
        const [hours, minutes] = time24.split(':');
        const hour = parseInt(hours);
        const ampm = hour >= 12 ? 'pm' : 'am';
        const hour12 = hour === 0 ? 12 : hour > 12 ? hour - 12 : hour;
        return `${hour12}:${minutes}${ampm}`;
    }

    formatLocalDate(date) {
        // Format as YYYY-MM-DD in local timezone
        const year = date.getFullYear();
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const day = String(date.getDate()).padStart(2, '0');
        return `${year}-${month}-${day}`;
    }

    formatLocalTime(date) {
        // Format as HH:MM in local timezone
        const hours = String(date.getHours()).padStart(2, '0');
        const minutes = String(date.getMinutes()).padStart(2, '0');
        return `${hours}:${minutes}`;
    }

    async sendShiftReminder(user, assignment) {
        try {
            const eventSummary = process.env.ICS_EVENT_SUMMARY || 'CareGiver Shift';
            
            const payload = {
                title: `⏰ Reminder`,
                body: `Reminder to ${eventSummary} at ${assignment.time_slot}`,
                icon: '/icons/icon-192x192.png',
                badge: '/icons/icon-192x192.png',
                data: {
                    type: 'shift_reminder',
                    date: assignment.day_date,
                    time: assignment.time_slot,
                    url: '/dashboard'
                },
                actions: []
            };

            await this.sendPushNotification(user.push_subscription, payload);
            console.log(`📨 ${eventSummary} reminder sent to ${user.first_name} ${user.last_name}`);
        } catch (error) {
            console.error('Error sending shift reminder:', error);
        }
    }

    async sendMorningSummaries() {
        if (!this.initialized) return;

        try {
            const now = new Date();
            const currentTime = this.formatLocalTime(now);
            const currentHour = now.getHours();
            const currentMinute = now.getMinutes();
            const today = this.formatLocalDate(now);

            // Get users who want morning summaries at this time (with 5-minute window)
            const users = await new Promise((resolve, reject) => {
                this.db.all(
                    `SELECT ns.user_id, ns.push_subscription, ns.morning_summary_time,
                     u.first_name, u.last_name
                     FROM notification_settings ns
                     JOIN users u ON ns.user_id = u.id
                     WHERE ns.push_enabled = 1 AND ns.morning_summary_enabled = 1 
                     AND ns.push_subscription IS NOT NULL`,
                    (err, rows) => {
                        if (err) reject(err);
                        else resolve(rows || []);
                    }
                );
            });

            // Only log if there are users to process or if we're sending summaries
            let logActivity = false;

            for (const user of users) {
                const [userHour, userMinute] = user.morning_summary_time.split(':').map(Number);
                
                // Check if we should send the morning summary (within 5-minute window of their preferred time)
                const shouldSend = (currentHour === userHour && 
                                  currentMinute >= userMinute && 
                                  currentMinute < userMinute + 5);
                
                if (shouldSend) {
                    // Check if we've already sent today's summary
                    const alreadySent = await this.hasAlreadySentMorningSummary(user.user_id, today);
                    if (!alreadySent) {
                        if (!logActivity) {
                            console.log(`🌅 Sending morning summaries at ${currentTime}`);
                            logActivity = true;
                        }
                        const sent = await this.sendMorningSummary(user, today);
                        if (sent) {
                            await this.markMorningSummarySent(user.user_id, today);
                            console.log(`📨 Morning summary sent to ${user.first_name} ${user.last_name}`);
                        } else {
                            // Deliberately not recording it: the UNIQUE(user_id, date)
                            // row is what stops the rest of the window from pushing a
                            // second summary, so writing it after a failed send would
                            // spend the user's only attempt on a push that never left.
                            console.error(`⚠️ Morning summary push to ${user.first_name} ${user.last_name} failed; leaving it unsent so the next run can retry`);
                        }
                    }
                }
            }
        } catch (error) {
            console.error('Error sending morning summaries:', error);
        }
    }

    async hasAlreadySentMorningSummary(userId, date) {
        try {
            const result = await new Promise((resolve, reject) => {
                this.db.get(
                    `SELECT id FROM morning_summary_log WHERE user_id = ? AND date = ?`,
                    [userId, date],
                    (err, row) => {
                        if (err) reject(err);
                        else resolve(row);
                    }
                );
            });
            return !!result;
        } catch (error) {
            console.error('Error checking morning summary log:', error);
            return false;
        }
    }

    async markMorningSummarySent(userId, date) {
        try {
            await this.dbHelper.runWithRetry(
                `INSERT OR REPLACE INTO morning_summary_log (user_id, date, sent_at) 
                 VALUES (?, ?, CURRENT_TIMESTAMP)`,
                [userId, date]
            );
        } catch (error) {
            console.error('Error marking morning summary as sent:', error);
        }
    }

    /**
     * Compose and push today's summary.
     *
     * Returns whether the push actually went out. The caller writes the dedupe row,
     * and a day marked sent on a push that failed is a day the user gets nothing.
     */
    async sendMorningSummary(user, date) {
        try {
            // Get today's assignments for the user
            const assignments = await new Promise((resolve, reject) => {
                this.db.all(
                    'SELECT time_slot FROM assignments WHERE user_id = ? AND day_date = ? ORDER BY time_slot',
                    [user.user_id, date],
                    (err, rows) => {
                        if (err) reject(err);
                        else resolve(rows || []);
                    }
                );
            });

            let body = '';
            if (assignments.length === 0) {
                body = 'No shifts scheduled for today. Enjoy your day!';
            } else if (assignments.length === 1) {
                body = `You have 1 shift today at ${assignments[0].time_slot}`;
            } else {
                const times = assignments.map(a => a.time_slot).join(', ');
                body = `You have ${assignments.length} shifts today at ${times}`;
            }

            const payload = {
                title: `🌅 Good morning, ${user.first_name}!`,
                body,
                icon: '/icons/icon-192x192.png',
                badge: '/icons/icon-192x192.png',
                data: {
                    type: 'morning_summary',
                    date,
                    url: '/dashboard'
                },
                actions: []
            };

            const sent = await this.sendPushNotification(user.push_subscription, payload);
            if (!sent) return false;

            console.log(`🌅 Morning summary sent to ${user.first_name} ${user.last_name}`);
            return true;
        } catch (error) {
            console.error('Error sending morning summary:', error);
            return false;
        }
    }

    async sendPushNotification(subscriptionData, payload) {
        try {
            if (!subscriptionData) {
                throw new Error('No subscription data provided');
            }

            const subscription = typeof subscriptionData === 'string' 
                ? JSON.parse(subscriptionData) 
                : subscriptionData;

            const options = {
                TTL: 3600, // 1 hour
                urgency: 'high', // High priority for immediate delivery
                vapidDetails: {
                    subject: process.env.VAPID_EMAIL || 'mailto:admin@example.com',
                    publicKey: process.env.VAPID_PUBLIC_KEY,
                    privateKey: process.env.VAPID_PRIVATE_KEY
                }
            };

            if (process.env.NOTIFICATION_DEBUG === 'true') {
                console.log('🚀 Attempting to send push notification:', {
                    endpoint: subscription.endpoint,
                    title: payload.title,
                    body: payload.body
                });
            }

            const result = await webpush.sendNotification(subscription, JSON.stringify(payload), options);
            
            if (process.env.NOTIFICATION_DEBUG === 'true') {
                console.log('✅ Push notification sent successfully:', result.statusCode || 'OK');
            }
            
            return true;
        } catch (error) {
            console.error('❌ Error sending push notification:', {
                message: error.message,
                statusCode: error.statusCode,
                headers: error.headers,
                body: error.body,
                endpoint: subscriptionData?.endpoint || 'unknown'
            });
            
            // If the endpoint is gone for good, delete it. Otherwise this row stays
            // push_enabled = 1 and every reminder job keeps POSTing to a dead URL
            // forever, while the user just quietly stops receiving anything.
            if (DEAD_SUBSCRIPTION_STATUS_CODES.has(error.statusCode)) {
                console.log(`📱 Push subscription is gone (${error.statusCode}), removing it...`);
                await this.removeSubscriptionForEndpoint(subscriptionData);
            } else if (error.statusCode === 400) {
                console.log('📱 Invalid push request - check subscription format');
            } else if (error.statusCode === 413) {
                console.log('📱 Payload too large');
            }
            
            return false;
        }
    }

    /**
     * Clear the stored subscription whoever owns it.
     *
     * The push service only tells us the endpoint failed, not which user it belongs
     * to, so the endpoint inside the stored JSON is the join key.
     */
    async removeSubscriptionForEndpoint(subscriptionData) {
        try {
            const targetEndpoint = this.readEndpoint(subscriptionData);
            if (!targetEndpoint) return false;

            const rows = await new Promise((resolve, reject) => {
                this.db.all(
                    'SELECT user_id, push_subscription FROM notification_settings WHERE push_subscription IS NOT NULL',
                    (err, rows) => {
                        if (err) reject(err);
                        else resolve(rows || []);
                    }
                );
            });

            const owners = rows.filter(row => this.readEndpoint(row.push_subscription) === targetEndpoint);
            for (const row of owners) {
                await this.unsubscribeUser(row.user_id);
            }
            return owners.length > 0;
        } catch (error) {
            console.error('Error removing dead push subscription:', error);
            return false;
        }
    }

    readEndpoint(subscriptionData) {
        try {
            const parsed = typeof subscriptionData === 'string'
                ? JSON.parse(subscriptionData)
                : subscriptionData;
            return parsed?.endpoint || null;
        } catch (error) {
            return null;
        }
    }

    stop() {
        // Stop all cron jobs
        for (const [name, job] of this.scheduledJobs) {
            job.stop();
            console.log(`⏹️  Stopped ${name} scheduler`);
        }
        this.scheduledJobs.clear();
    }
}

// Shared with the API, which refuses a summary time the scheduler can never deliver.
NotificationService.MORNING_SUMMARY_WINDOW = MORNING_SUMMARY_WINDOW;

module.exports = NotificationService;