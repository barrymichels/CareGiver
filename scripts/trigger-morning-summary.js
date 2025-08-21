#!/usr/bin/env node

/**
 * Manual Morning Summary Trigger
 * 
 * This script manually triggers morning summaries for testing purposes.
 * Useful for immediate testing without waiting for the cron schedule.
 */

require('dotenv').config();
const sqlite3 = require('sqlite3').verbose();
const NotificationService = require('../services/notificationService');

async function triggerMorningSummary() {
    console.log('🧪 Manually triggering morning summary...\n');
    
    // Connect to database
    const dbPath = process.env.DB_PATH || './data/database.sqlite';
    const db = new sqlite3.Database(dbPath);
    
    try {
        // Initialize notification service
        const notificationService = new NotificationService(db);
        
        // Wait a moment for initialization
        await new Promise(resolve => setTimeout(resolve, 1000));
        
        console.log('📋 Current notification settings:');
        
        // Show current settings
        const settings = await new Promise((resolve, reject) => {
            db.all(`
                SELECT ns.user_id, u.first_name, u.last_name,
                       ns.morning_summary_enabled, ns.morning_summary_time,
                       ns.push_enabled,
                       CASE WHEN ns.push_subscription IS NOT NULL THEN 'Yes' ELSE 'No' END as has_subscription
                FROM notification_settings ns
                JOIN users u ON ns.user_id = u.id
                WHERE ns.push_enabled = 1 AND ns.morning_summary_enabled = 1
            `, (err, rows) => {
                if (err) reject(err);
                else resolve(rows || []);
            });
        });
        
        if (settings.length === 0) {
            console.log('❌ No users have push notifications enabled with morning summaries');
            console.log('\nTo enable notifications:');
            console.log('1. Go to /profile in your browser');
            console.log('2. Click "Enable Push Notifications"');
            console.log('3. Allow the permission when prompted');
            console.log('4. Save your notification settings');
            return;
        }
        
        settings.forEach(setting => {
            console.log(`   ${setting.first_name} ${setting.last_name}: Summary at ${setting.morning_summary_time}, Subscription: ${setting.has_subscription}`);
        });
        
        console.log('\n🚀 Manually triggering morning summaries...');
        
        // Manually call the morning summary function
        await notificationService.sendMorningSummaries();
        
        console.log('✅ Morning summary trigger completed');
        
    } catch (error) {
        console.error('❌ Error:', error);
    } finally {
        db.close();
    }
}

triggerMorningSummary().catch(console.error);