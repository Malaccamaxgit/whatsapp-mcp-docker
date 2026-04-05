/**
 * Timezone Formatting Tests
 *
 * Tests for src/utils/timezone.ts - timezone-aware timestamp formatting
 * with 24-hour format (no AM/PM).
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import {
  getUserTimezone,
  formatTimestamp,
  formatTimeOnly,
  formatTimestampISO
} from '../../src/utils/timezone.js';

describe('Timezone Utilities', () => {
  let originalTZ: string | undefined;

  beforeEach(() => {
    // Save original TZ
    originalTZ = process.env.TZ;
  });

  afterEach(() => {
    // Restore original TZ
    if (originalTZ !== undefined) {
      process.env.TZ = originalTZ;
    } else {
      delete process.env.TZ;
    }
  });

  describe('getUserTimezone()', () => {
    it('should return TZ from environment variable', () => {
      process.env.TZ = 'America/New_York';
      assert.strictEqual(getUserTimezone(), 'America/New_York');
    });

    it('should return default timezone when TZ is not set', () => {
      delete process.env.TZ;
      assert.strictEqual(getUserTimezone(), 'America/Toronto');
    });

    it('should return default timezone when TZ is empty', () => {
      process.env.TZ = '';
      assert.strictEqual(getUserTimezone(), 'America/Toronto');
    });

    it('should support common IANA timezones', () => {
      const timezones = [
        'America/Toronto',
        'America/New_York',
        'America/Los_Angeles',
        'Europe/Paris',
        'Europe/London',
        'Asia/Tokyo',
        'UTC'
      ];

      for (const tz of timezones) {
        process.env.TZ = tz;
        assert.strictEqual(getUserTimezone(), tz, `Should support ${tz}`);
      }
    });
  });

  describe('formatTimestamp()', () => {
    it('should format timestamp in 24-hour format (no AM/PM)', () => {
      process.env.TZ = 'America/Toronto';
      
      // Test afternoon time (17:46:02 should NOT show as 5:46:02 PM)
      const timestamp = Math.floor(new Date('2026-04-04T17:46:02-04:00').getTime() / 1000);
      const formatted = formatTimestamp(timestamp);
      
      // Should contain 24-hour time
      assert.match(formatted, /17:46:02/);
      // Should NOT contain AM or PM
      assert.doesNotMatch(formatted, /AM|PM|am|pm/);
    });

    it('should format morning time correctly in 24-hour format', () => {
      process.env.TZ = 'America/Toronto';
      
      // Test morning time (09:30:15)
      const timestamp = Math.floor(new Date('2026-04-04T09:30:15-04:00').getTime() / 1000);
      const formatted = formatTimestamp(timestamp);
      
      assert.match(formatted, /09:30:15/);
      assert.doesNotMatch(formatted, /AM|PM|am|pm/);
    });

    it('should format midnight correctly', () => {
      process.env.TZ = 'America/Toronto';
      
      // Test midnight (00:00:00)
      const timestamp = Math.floor(new Date('2026-04-04T00:00:00-04:00').getTime() / 1000);
      const formatted = formatTimestamp(timestamp);
      
      assert.match(formatted, /00:00:00/);
      assert.doesNotMatch(formatted, /AM|PM|am|pm/);
    });

    it('should use ISO-like date format (YYYY-MM-DD)', () => {
      process.env.TZ = 'America/Toronto';
      
      const timestamp = Math.floor(new Date('2026-04-04T17:46:02-04:00').getTime() / 1000);
      const formatted = formatTimestamp(timestamp);
      
      // Should match YYYY-MM-DD format
      assert.match(formatted, /2026-04-04/);
    });

    it('should respect different timezones', () => {
      // Same UTC timestamp, different timezones
      const utcTimestamp = Math.floor(new Date('2026-04-04T21:46:02Z').getTime() / 1000);
      
      // Toronto (EDT, UTC-4)
      process.env.TZ = 'America/Toronto';
      const toronto = formatTimestamp(utcTimestamp);
      assert.match(toronto, /17:46:02/); // 21:46 UTC - 4h = 17:46
      
      // Paris (CEST, UTC+2)
      process.env.TZ = 'Europe/Paris';
      const paris = formatTimestamp(utcTimestamp);
      assert.match(paris, /23:46:02/); // 21:46 UTC + 2h = 23:46
      
      // Tokyo (JST, UTC+9)
      process.env.TZ = 'Asia/Tokyo';
      const tokyo = formatTimestamp(utcTimestamp);
      assert.match(tokyo, /06:46:02/); // 21:46 UTC + 9h = 06:46 (next day)
    });

    it('should handle DST transitions', () => {
      // Winter (EST, UTC-5)
      process.env.TZ = 'America/Toronto';
      const winterTimestamp = Math.floor(new Date('2026-01-15T17:00:00-05:00').getTime() / 1000);
      const winter = formatTimestamp(winterTimestamp);
      assert.match(winter, /17:00:00/);
      
      // Summer (EDT, UTC-4)
      const summerTimestamp = Math.floor(new Date('2026-07-15T17:00:00-04:00').getTime() / 1000);
      const summer = formatTimestamp(summerTimestamp);
      assert.match(summer, /17:00:00/);
    });
  });

  describe('formatTimeOnly()', () => {
    it('should return time-only in 24-hour format', () => {
      process.env.TZ = 'America/Toronto';
      
      const timestamp = Math.floor(new Date('2026-04-04T17:46:02-04:00').getTime() / 1000);
      const time = formatTimeOnly(timestamp);
      
      assert.strictEqual(time, '17:46:02');
      assert.doesNotMatch(time, /AM|PM|am|pm/);
    });

    it('should handle single-digit hours with leading zero', () => {
      process.env.TZ = 'America/Toronto';
      
      const timestamp = Math.floor(new Date('2026-04-04T09:05:03-04:00').getTime() / 1000);
      const time = formatTimeOnly(timestamp);
      
      assert.strictEqual(time, '09:05:03');
    });

    it('should handle midnight', () => {
      process.env.TZ = 'America/Toronto';
      
      const timestamp = Math.floor(new Date('2026-04-04T00:00:00-04:00').getTime() / 1000);
      const time = formatTimeOnly(timestamp);
      
      assert.strictEqual(time, '00:00:00');
    });

    it('should handle noon', () => {
      process.env.TZ = 'America/Toronto';
      
      const timestamp = Math.floor(new Date('2026-04-04T12:00:00-04:00').getTime() / 1000);
      const time = formatTimeOnly(timestamp);
      
      assert.strictEqual(time, '12:00:00');
      assert.doesNotMatch(time, /AM|PM|am|pm/);
    });
  });

  describe('formatTimestampISO()', () => {
    it('should return ISO 8601 format', () => {
      const timestamp = Math.floor(new Date('2026-04-04T17:46:02Z').getTime() / 1000);
      const iso = formatTimestampISO(timestamp);
      
      // Should match ISO 8601 format
      assert.match(iso, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    });

    it('should always return UTC (Z suffix)', () => {
      // Set timezone to something non-UTC
      process.env.TZ = 'America/Toronto';
      
      const timestamp = Math.floor(new Date('2026-04-04T17:46:02-04:00').getTime() / 1000);
      const iso = formatTimestampISO(timestamp);
      
      // Should end with Z (UTC)
      assert.match(iso, /Z$/);
    });
  });

  describe('Edge Cases', () => {
    it('should handle very old timestamps', () => {
      process.env.TZ = 'America/Toronto';
      
      // Unix epoch (1970-01-01 00:00:00 UTC)
      const timestamp = 0;
      const formatted = formatTimestamp(timestamp);
      
      // Should contain year 1969 or 1970 depending on timezone offset
      assert.match(formatted, /1969|1970/);
      // Should NOT contain AM/PM
      assert.doesNotMatch(formatted, /AM|PM|am|pm/);
    });

    it('should handle future timestamps', () => {
      process.env.TZ = 'America/Toronto';
      
      // Year 2099
      const timestamp = Math.floor(new Date('2099-12-31T23:59:59-05:00').getTime() / 1000);
      const formatted = formatTimestamp(timestamp);
      
      assert.match(formatted, /2099-12-31/);
      assert.match(formatted, /23:59:59/);
    });

    it('should handle leap years', () => {
      process.env.TZ = 'America/Toronto';
      
      // February 29, 2028 (leap year)
      const timestamp = Math.floor(new Date('2028-02-29T12:00:00-05:00').getTime() / 1000);
      const formatted = formatTimestamp(timestamp);
      
      assert.match(formatted, /2028-02-29/);
    });
  });

  describe('Integration with Message Formatting', () => {
    it('should format timestamps consistently across different message types', () => {
      process.env.TZ = 'America/Toronto';
      
      const testCases = [
        { desc: 'morning message', time: '09:15:30', expected: '09:15:30' },
        { desc: 'afternoon message', time: '14:30:45', expected: '14:30:45' },
        { desc: 'evening message', time: '19:45:00', expected: '19:45:00' },
        { desc: 'night message', time: '23:59:59', expected: '23:59:59' }
      ];

      for (const { desc, time, expected } of testCases) {
        const timestamp = Math.floor(new Date(`2026-04-04T${time}-04:00`).getTime() / 1000);
        const formatted = formatTimestamp(timestamp);
        
        assert.match(formatted, new RegExp(expected), `Failed for ${desc}`);
        assert.doesNotMatch(formatted, /AM|PM|am|pm/, `${desc} should not have AM/PM`);
      }
    });
  });
});
