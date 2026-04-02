#!/usr/bin/env node
/**
 * Diagnostic Script for WhatsApp MCP Server
 *
 * Runs diagnostic commands to help troubleshoot issues.
 * Similar to 'npm run docker:status' but with more details.
 *
 * Usage:
 *   node scripts/diagnostics.js
 *   node scripts/diagnostics.js --verbose
 *   node scripts/diagnostics.js --json
 */

import { execSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const VERBOSE = process.argv.includes('--verbose');
const JSON_OUTPUT = process.argv.includes('--json');

function run(cmd) {
  try {
    return execSync(cmd, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
  } catch (err) {
    return null;
  }
}

function checkContainer() {
  const output = run('docker compose ps whatsapp-mcp-docker');
  if (!output) {
    return { running: false, error: 'Container not found' };
  }

  const isRunning = output.includes('Up') || output.includes('running');
  return {
    running: isRunning,
    output: output.trim(),
  };
}

function checkVolumes() {
  const volumes = ['whatsapp-sessions', 'whatsapp-audit'];
  const results = {};

  for (const vol of volumes) {
    const output = run(`docker volume ls --filter name=${vol}`);
    results[vol] = output && output.includes(vol);
  }

  return results;
}

function checkSessionFile() {
  const sessionPath = '.test-data/session.db';
  const exists = existsSync(sessionPath);
  return {
    exists,
    path: sessionPath,
    size: exists ? require('node:fs').statSync(sessionPath).size : null,
  };
}

function getLogs(lines = 50) {
  const output = run(`docker compose logs --tail ${lines} whatsapp-mcp-docker`);
  if (!output) return null;

  const linesArray = output.split('\n');
  const errors = linesArray.filter(l => l.toLowerCase().includes('error') || l.toLowerCase().includes('fail'));
  const warnings = linesArray.filter(l => l.toLowerCase().includes('warn'));

  return {
    full: output,
    errors: errors.length,
    warnings: warnings.length,
    recent: linesArray.slice(-10).join('\n'),
  };
}

function checkEncryption() {
  const composeFile = 'docker-compose.yml';
  if (!existsSync(composeFile)) return null;

  const content = readFileSync(composeFile, 'utf8');
  const hasEncryption = content.includes('DATA_ENCRYPTION_KEY');
  const usesSecret = content.includes('${DATA_ENCRYPTION_KEY}');

  return {
    configured: hasEncryption,
    usesSecret: usesSecret,
  };
}

function checkCatalog() {
  const output = run('docker mcp catalog list');
  if (!output) return null;

  const hasCustom = output.includes('whatsapp-mcp-docker') || output.includes('WhatsApp MCP');
  return {
    registered: hasCustom,
  };
}

function checkProfile() {
  const output = run('docker mcp profile list');
  if (!output) return null;

  const lines = output.split('\n');
  const profiles = lines.filter(l => l.trim() && !l.startsWith('─'));

  return {
    available: profiles,
  };
}

function getSystemInfo() {
  const dockerVersion = run('docker --version');
  const composeVersion = run('docker compose version');
  const nodeVersion = process.version;

  return {
    docker: dockerVersion?.trim(),
    compose: composeVersion?.trim(),
    node: nodeVersion,
    platform: process.platform,
  };
}

function main() {
  console.error('🔍 WhatsApp MCP Server Diagnostics\n');

  const diagnostics = {
    timestamp: new Date().toISOString(),
    system: getSystemInfo(),
    container: checkContainer(),
    volumes: checkVolumes(),
    session: checkSessionFile(),
    encryption: checkEncryption(),
    catalog: checkCatalog(),
    profile: checkProfile(),
    logs: getLogs(),
  };

  if (JSON_OUTPUT) {
    console.log(JSON.stringify(diagnostics, null, 2));
    return;
  }

  // Print formatted output
  console.log('System Information:');
  console.log(`  Docker: ${diagnostics.system.docker || 'Not found'}`);
  console.log(`  Compose: ${diagnostics.system.compose || 'Not found'}`);
  console.log(`  Node: ${diagnostics.system.node}`);
  console.log(`  Platform: ${diagnostics.system.platform}\n`);

  console.log('Container Status:');
  console.log(`  Running: ${diagnostics.container.running ? '✅ Yes' : '❌ No'}`);
  if (diagnostics.container.error) {
    console.log(`  Error: ${diagnostics.container.error}`);
  }
  console.log('');

  console.log('Volumes:');
  for (const [name, exists] of Object.entries(diagnostics.volumes)) {
    console.log(`  ${name}: ${exists ? '✅ Exists' : '❌ Missing'}`);
  }
  console.log('');

  console.log('Session File:');
  console.log(`  Path: ${diagnostics.session.path}`);
  console.log(`  Exists: ${diagnostics.session.exists ? '✅ Yes' : '❌ No'}`);
  if (diagnostics.session.size) {
    console.log(`  Size: ${(diagnostics.session.size / 1024).toFixed(2)} KB`);
  }
  console.log('');

  console.log('Encryption:');
  console.log(`  Configured: ${diagnostics.encryption?.configured ? '✅ Yes' : '⚠️  No'}`);
  console.log(`  Uses Secret: ${diagnostics.encryption?.usesSecret ? '✅ Yes' : '⚠️  No'}`);
  console.log('');

  console.log('MCP Toolkit:');
  console.log(`  Catalog Registered: ${diagnostics.catalog?.registered ? '✅ Yes' : '❌ No'}`);
  if (diagnostics.profile?.available.length > 0) {
    console.log(`  Profiles: ${diagnostics.profile.available.join(', ')}`);
  }
  console.log('');

  console.log('Recent Logs:');
  if (diagnostics.logs) {
    console.log(`  Total Errors: ${diagnostics.logs.errors}`);
    console.log(`  Total Warnings: ${diagnostics.logs.warnings}`);
    console.log('  Last 10 lines:');
    diagnostics.logs.recent.split('\n').forEach(line => {
      console.log(`    ${line}`);
    });
  } else {
    console.log('  No logs available');
  }

  if (VERBOSE) {
    console.log('\n📋 Full Log Output:');
    console.log('─'.repeat(60));
    console.log(diagnostics.logs?.full || 'No logs available');
  }

  // Summary
  console.log('\n📊 Summary:');
  const issues = [];
  if (!diagnostics.container.running) issues.push('Container not running');
  if (!diagnostics.volumes['whatsapp-sessions']) issues.push('Session volume missing');
  if (!diagnostics.catalog?.registered) issues.push('Catalog not registered');
  if (!diagnostics.encryption?.configured) issues.push('Encryption not configured');

  if (issues.length === 0) {
    console.log('  ✅ All checks passed - system appears healthy');
  } else {
    console.log('  ⚠️  Issues found:');
    issues.forEach(issue => console.log(`    - ${issue}`));
  }
}

main();
