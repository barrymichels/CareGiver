#!/usr/bin/env node

/**
 * Test Script for Push Notifications Setup
 * 
 * This script validates the push notification setup without starting the full server.
 * Run this after setting up your environment to ensure everything is configured correctly.
 * 
 * Usage: node scripts/test-notifications.js
 */

require('dotenv').config();

async function testNotificationSetup() {
    console.log('🧪 Testing Push Notification Setup...\n');
    
    let allTestsPassed = true;
    
    // Test 1: Check required dependencies
    console.log('1. Checking required dependencies...');
    try {
        require('web-push');
        require('node-cron');
        console.log('   ✅ Dependencies installed');
    } catch (error) {
        console.log('   ❌ Missing dependencies. Run: npm install');
        allTestsPassed = false;
    }
    
    // Test 2: Check VAPID keys
    console.log('2. Checking VAPID configuration...');
    const vapidPublic = process.env.VAPID_PUBLIC_KEY;
    const vapidPrivate = process.env.VAPID_PRIVATE_KEY;
    const vapidEmail = process.env.VAPID_EMAIL;
    
    if (!vapidPublic || !vapidPrivate || !vapidEmail) {
        console.log('   ❌ VAPID keys not configured in .env file');
        console.log('   📝 Run: node scripts/generate-vapid.js');
        allTestsPassed = false;
    } else {
        console.log('   ✅ VAPID keys configured');
    }
    
    // Test 3: Validate VAPID key format
    console.log('3. Validating VAPID key format...');
    if (vapidPublic && vapidPrivate) {
        try {
            const webpush = require('web-push');
            webpush.setVapidDetails(vapidEmail, vapidPublic, vapidPrivate);
            console.log('   ✅ VAPID keys are valid');
        } catch (error) {
            console.log('   ❌ Invalid VAPID keys:', error.message);
            console.log('   📝 Generate new keys: node scripts/generate-vapid.js');
            allTestsPassed = false;
        }
    }
    
    // Test 4: Check database initialization script
    console.log('4. Checking database schema...');
    try {
        const initDb = require('../config/database.init');
        console.log('   ✅ Database initialization script found');
    } catch (error) {
        console.log('   ❌ Database initialization error:', error.message);
        allTestsPassed = false;
    }
    
    // Test 5: Check notification service
    console.log('5. Checking notification service...');
    try {
        const NotificationService = require('../services/notificationService');
        console.log('   ✅ Notification service can be imported');
    } catch (error) {
        console.log('   ❌ Notification service error:', error.message);
        allTestsPassed = false;
    }
    
    // Test 6: Check routes
    console.log('6. Checking notification routes...');
    try {
        const notificationRoutes = require('../routes/notifications');
        console.log('   ✅ Notification routes can be imported');
    } catch (error) {
        console.log('   ❌ Notification routes error:', error.message);
        allTestsPassed = false;
    }
    
    // Summary
    console.log('\n' + '='.repeat(50));
    if (allTestsPassed) {
        console.log('🎉 All tests passed! Push notifications are ready to use.');
        console.log('\nNext steps:');
        console.log('1. Start your server: npm start');
        console.log('2. Go to your profile page to enable notifications');
        console.log('3. Test the notification system');
    } else {
        console.log('❌ Some tests failed. Please fix the issues above.');
        console.log('\nCommon fixes:');
        console.log('• Install dependencies: npm install');
        console.log('• Generate VAPID keys: node scripts/generate-vapid.js');
        console.log('• Update your .env file with the generated keys');
    }
    console.log('='.repeat(50));
}

// Run the tests
testNotificationSetup().catch(error => {
    console.error('Test script error:', error);
    process.exit(1);
});