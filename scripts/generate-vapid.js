#!/usr/bin/env node

/**
 * VAPID Key Generator
 * 
 * This script generates VAPID keys required for web push notifications.
 * Run this script once during setup and add the keys to your .env file.
 * 
 * Usage: node scripts/generate-vapid.js
 */

const webpush = require('web-push');

console.log('Generating VAPID keys for push notifications...\n');

try {
    const vapidKeys = webpush.generateVAPIDKeys();
    
    console.log('✅ VAPID keys generated successfully!\n');
    console.log('Add these to your .env file:\n');
    console.log('VAPID_PUBLIC_KEY=' + vapidKeys.publicKey);
    console.log('VAPID_PRIVATE_KEY=' + vapidKeys.privateKey);
    console.log('VAPID_EMAIL=mailto:admin@yourdomain.com');
    console.log('\nReplace admin@yourdomain.com with your actual contact email.');
    console.log('\n⚠️  Keep these keys secure! Do not commit them to version control.');
    
} catch (error) {
    console.error('❌ Error generating VAPID keys:', error.message);
    process.exit(1);
}