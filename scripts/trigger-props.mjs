#!/usr/bin/env node
/**
 * Manual script to trigger the daily props generation job
 * Usage: node scripts/trigger-props.mjs
 */

import fetch from 'node-fetch';

const API_URL = process.env.API_URL || 'http://localhost:3000';

async function triggerPropsJob() {
  try {
    console.log('🔄 Triggering daily props job...');
    
    const response = await fetch(`${API_URL}/api/trpc/admin.triggerDailyPropsJob`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({}),
    });

    const data = await response.json();
    
    if (data.result?.data?.success) {
      console.log('✅ Props job completed successfully!');
      console.log(data.result.data.message);
    } else {
      console.error('❌ Props job failed:', data.result?.data?.message || 'Unknown error');
    }
  } catch (error) {
    console.error('❌ Error triggering props job:', error instanceof Error ? error.message : error);
    process.exit(1);
  }
}

triggerPropsJob();
