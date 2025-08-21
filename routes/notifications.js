const express = require('express');
const router = express.Router();
const { isAuthenticated, isActive } = require('../middleware/auth');

module.exports = function(db, notificationService) {
    // Subscribe to push notifications
    router.post('/subscribe', isAuthenticated, isActive, async (req, res) => {
        try {
            const { subscription } = req.body;
            
            if (!subscription || !subscription.endpoint) {
                return res.status(400).json({ error: 'Invalid subscription data' });
            }

            const success = await notificationService.subscribeUser(req.user.id, subscription);
            
            if (success) {
                res.json({ message: 'Successfully subscribed to push notifications' });
            } else {
                res.status(500).json({ error: 'Failed to subscribe to push notifications' });
            }
        } catch (error) {
            console.error('Error subscribing to push notifications:', error);
            res.status(500).json({ error: 'Server error' });
        }
    });

    // Unsubscribe from push notifications
    router.delete('/subscribe', isAuthenticated, isActive, async (req, res) => {
        try {
            const success = await notificationService.unsubscribeUser(req.user.id);
            
            if (success) {
                res.json({ message: 'Successfully unsubscribed from push notifications' });
            } else {
                res.status(500).json({ error: 'Failed to unsubscribe from push notifications' });
            }
        } catch (error) {
            console.error('Error unsubscribing from push notifications:', error);
            res.status(500).json({ error: 'Server error' });
        }
    });

    // Get notification preferences
    router.get('/preferences', isAuthenticated, isActive, async (req, res) => {
        try {
            const preferences = await notificationService.getNotificationPreferences(req.user.id);
            
            if (preferences) {
                res.json(preferences);
            } else {
                res.status(500).json({ error: 'Failed to get notification preferences' });
            }
        } catch (error) {
            console.error('Error getting notification preferences:', error);
            res.status(500).json({ error: 'Server error' });
        }
    });

    // Update notification preferences
    router.put('/preferences', isAuthenticated, isActive, async (req, res) => {
        try {
            const { 
                notificationAdvanceMinutes, 
                morningSummaryEnabled, 
                morningSummaryTime 
            } = req.body;

            // Validate input
            if (notificationAdvanceMinutes !== undefined) {
                if (typeof notificationAdvanceMinutes !== 'number' || 
                    notificationAdvanceMinutes < 5 || 
                    notificationAdvanceMinutes > 120) {
                    return res.status(400).json({ 
                        error: 'Notification advance time must be between 5 and 120 minutes' 
                    });
                }
            }

            if (morningSummaryTime !== undefined) {
                const timeRegex = /^([01]?[0-9]|2[0-3]):[0-5][0-9]$/;
                if (!timeRegex.test(morningSummaryTime)) {
                    return res.status(400).json({ 
                        error: 'Invalid time format. Use HH:MM format' 
                    });
                }
            }

            const preferences = {
                notificationAdvanceMinutes,
                morningSummaryEnabled,
                morningSummaryTime
            };

            const success = await notificationService.updateNotificationPreferences(
                req.user.id, 
                preferences
            );
            
            if (success) {
                res.json({ message: 'Notification preferences updated successfully' });
            } else {
                res.status(500).json({ error: 'Failed to update notification preferences' });
            }
        } catch (error) {
            console.error('Error updating notification preferences:', error);
            res.status(500).json({ error: 'Server error' });
        }
    });

    // Test endpoint to send a test notification (development only)
    router.post('/test', isAuthenticated, isActive, async (req, res) => {
        // Only allow in development mode
        if (process.env.NODE_ENV === 'production') {
            return res.status(404).json({ error: 'Not found' });
        }

        try {
            const preferences = await notificationService.getNotificationPreferences(req.user.id);
            
            if (!preferences || !preferences.push_enabled) {
                return res.status(400).json({ 
                    error: 'Push notifications not enabled for this user' 
                });
            }

            // Get push subscription
            const subscription = await new Promise((resolve, reject) => {
                db.get(
                    'SELECT push_subscription FROM notification_settings WHERE user_id = ?',
                    [req.user.id],
                    (err, row) => {
                        if (err) reject(err);
                        else resolve(row?.push_subscription);
                    }
                );
            });

            if (!subscription) {
                return res.status(400).json({ 
                    error: 'No push subscription found for this user' 
                });
            }

            const testPayload = {
                title: '🧪 Test Notification',
                body: 'This is a test notification from WayneScheduler!',
                icon: '/icons/icon-192x192.png',
                badge: '/icons/icon-192x192.png',
                data: {
                    type: 'test',
                    url: '/dashboard'
                }
            };

            const success = await notificationService.sendPushNotification(subscription, testPayload);
            
            if (success) {
                res.json({ message: 'Test notification sent successfully' });
            } else {
                res.status(500).json({ error: 'Failed to send test notification' });
            }
        } catch (error) {
            console.error('Error sending test notification:', error);
            res.status(500).json({ error: 'Server error' });
        }
    });

    // Get VAPID public key for client-side subscription
    router.get('/vapid-public-key', (req, res) => {
        const publicKey = process.env.VAPID_PUBLIC_KEY;
        
        if (!publicKey) {
            return res.status(500).json({ error: 'VAPID public key not configured' });
        }
        
        res.json({ publicKey });
    });

    return router;
};