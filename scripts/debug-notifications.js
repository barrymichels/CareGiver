#!/usr/bin/env node

/**
 * Debug Script for Push Notifications
 * 
 * This script helps debug notification issues by showing:
 * - Current time and cron schedule status
 * - User notification settings
 * - Database state
 * - Manual trigger options
 */

require('dotenv').config();
const sqlite3 = require('sqlite3').verbose();
const path = require('path');

async function debugNotifications() {
    console.log('🔍 Debugging Push Notifications...\n');
    
    // Connect to database
    const dbPath = process.env.DB_PATH || './data/database.sqlite';
    const db = new sqlite3.Database(dbPath);
    
    try {
        // Show current time info
        const now = new Date();
        console.log('⏰ Current Time Info:');
        console.log(`   Current Date: ${now.toISOString().split('T')[0]}`);
        console.log(`   Current Time: ${now.toTimeString().slice(0, 5)}`);
        console.log(`   Current Hour: ${now.getHours()}`);
        console.log(`   Current Minute: ${now.getMinutes()}\n`);
        
        // Check if we're in the morning summary time window
        const hour = now.getHours();
        const inMorningWindow = hour >= 6 && hour <= 10;
        console.log(`📅 Morning Summary Window (6-10 AM): ${inMorningWindow ? '✅ Active' : '❌ Inactive'}\n`);
        
        // Get notification settings
        console.log('👤 User Notification Settings:');
        const settings = await new Promise((resolve, reject) => {
            db.all(`
                SELECT ns.user_id, u.first_name, u.last_name, u.email,
                       ns.notification_advance_minutes, ns.morning_summary_enabled,
                       ns.morning_summary_time, ns.push_enabled,
                       CASE WHEN ns.push_subscription IS NOT NULL THEN 'Yes' ELSE 'No' END as has_subscription
                FROM notification_settings ns
                JOIN users u ON ns.user_id = u.id
            `, (err, rows) => {
                if (err) reject(err);
                else resolve(rows || []);
            });
        });
        
        if (settings.length === 0) {
            console.log('   ⚠️  No users have notification settings configured');
        } else {
            settings.forEach(setting => {
                console.log(`   User: ${setting.first_name} ${setting.last_name} (${setting.email})`);
                console.log(`     Morning Summary: ${setting.morning_summary_enabled ? 'Enabled' : 'Disabled'} at ${setting.morning_summary_time}`);
                console.log(`     Push Enabled: ${setting.push_enabled ? 'Yes' : 'No'}`);
                console.log(`     Has Subscription: ${setting.has_subscription}`);
                console.log(`     Advance Minutes: ${setting.notification_advance_minutes}`);
                console.log('');
            });
        }
        
        // Get today's assignments
        const today = now.toISOString().split('T')[0];
        console.log(`📋 Today's Assignments (${today}):`);
        const assignments = await new Promise((resolve, reject) => {
            db.all(`
                SELECT a.user_id, u.first_name, u.last_name, a.day_date, a.time_slot
                FROM assignments a
                JOIN users u ON a.user_id = u.id
                WHERE a.day_date = ?
                ORDER BY a.time_slot
            `, [today], (err, rows) => {
                if (err) reject(err);
                else resolve(rows || []);
            });
        });
        
        if (assignments.length === 0) {
            console.log('   📭 No assignments for today');
        } else {
            assignments.forEach(assignment => {
                console.log(`   ${assignment.first_name} ${assignment.last_name}: ${assignment.time_slot}`);
            });
        }
        
        console.log('\n🔧 Debugging Tips:');
        console.log('1. Morning summaries only run every 5 minutes during 6-10 AM');
        console.log('2. The time must match exactly (e.g., 06:05, 06:10, 06:15, etc.)');
        console.log('3. Check server logs for cron job activity');
        console.log('4. Ensure VAPID keys are configured correctly');
        
        // Check if current time would trigger morning summary
        const currentTime = now.toTimeString().slice(0, 5);
        const minute = now.getMinutes();
        const isExactFiveMinute = minute % 5 === 0;
        
        console.log('\n⚡ Current Status:');
        console.log(`   Would morning summary trigger now? ${inMorningWindow && isExactFiveMinute ? '✅ Yes' : '❌ No'}`);
        console.log(`   Reason: ${!inMorningWindow ? 'Outside 6-10 AM window' : !isExactFiveMinute ? 'Not on 5-minute boundary' : 'Should trigger!'}`);
        
        // Show users who would get notifications right now
        if (inMorningWindow && isExactFiveMinute) {
            const eligibleUsers = settings.filter(s => 
                s.morning_summary_enabled && 
                s.push_enabled && 
                s.has_subscription === 'Yes' && 
                s.morning_summary_time === currentTime
            );
            
            console.log('\n🎯 Users eligible for morning summary right now:');
            if (eligibleUsers.length === 0) {
                console.log('   None (no users have morning_summary_time set to ' + currentTime + ')');
            } else {
                eligibleUsers.forEach(user => {
                    console.log(`   - ${user.first_name} ${user.last_name}`);
                });
            }
        }
        
    } catch (error) {
        console.error('Debug error:', error);
    } finally {
        db.close();
    }
}

debugNotifications().catch(console.error);