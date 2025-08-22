#!/usr/bin/env node

/**
 * Manual Push Notification Test Script
 * 
 * This script sends a test notification to all subscribed users
 * to verify that push notification delivery is working.
 * 
 * Usage: node scripts/test-push-delivery.js
 */

require('dotenv').config();
const sqlite3 = require('sqlite3').verbose();
const NotificationService = require('../services/notificationService');

async function testPushDelivery() {
    console.log('🧪 Testing Push Notification Delivery...\n');
    
    // Connect to database
    const dbPath = process.env.DB_PATH || './data/database.sqlite';
    const db = new sqlite3.Database(dbPath);
    
    try {
        // Initialize notification service
        const notificationService = new NotificationService(db);
        
        // Wait a moment for initialization
        await new Promise(resolve => setTimeout(resolve, 1000));
        
        if (!notificationService.initialized) {
            console.log('❌ Notification service failed to initialize');
            return;
        }
        
        // Get all users with push subscriptions
        const users = await new Promise((resolve, reject) => {
            db.all(`
                SELECT ns.user_id, ns.push_subscription, u.first_name, u.last_name, u.email
                FROM notification_settings ns
                JOIN users u ON ns.user_id = u.id
                WHERE ns.push_enabled = 1 AND ns.push_subscription IS NOT NULL
            `, (err, rows) => {
                if (err) reject(err);
                else resolve(rows || []);
            });
        });
        
        if (users.length === 0) {
            console.log('📭 No users with push subscriptions found');
            return;
        }
        
        console.log(`📱 Found ${users.length} users with push subscriptions:\n`);
        
        for (const user of users) {
            console.log(`🧪 Testing delivery to ${user.first_name} ${user.last_name} (${user.email})`);
            
            const testPayload = {
                title: '🧪 Test Notification',
                body: `This is a test notification for ${user.first_name}. If you see this, push notifications are working!`,
                icon: '/icons/icon-192x192.png',
                badge: '/icons/icon-192x192.png',
                data: {
                    type: 'test',
                    timestamp: new Date().toISOString(),
                    url: '/dashboard'
                },
                actions: [
                    {
                        action: 'view',
                        title: 'View Dashboard'
                    }
                ]
            };
            
            try {
                const success = await notificationService.sendPushNotification(user.push_subscription, testPayload);
                if (success) {
                    console.log(`   ✅ Test notification sent successfully`);
                } else {
                    console.log(`   ❌ Test notification failed to send`);
                }
            } catch (error) {
                console.log(`   ❌ Error sending test notification:`, error.message);
            }
            
            console.log(''); // Empty line for readability
        }
        
    } catch (error) {
        console.error('Test script error:', error);
    } finally {
        db.close();
        console.log('🏁 Test completed');
        process.exit(0);
    }
}

// Run the test
testPushDelivery().catch(error => {
    console.error('Test script error:', error);
    process.exit(1);
});