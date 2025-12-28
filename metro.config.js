// Learn more https://docs.expo.io/guides/customizing-metro
const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');
const os = require('os');

/** @type {import('expo/metro-config').MetroConfig} */
const config = getDefaultConfig(__dirname);

// Fix cache permission issues by using project's cache directory instead of /tmp
// Set cache directory to project's node_modules/.cache
const fs = require('fs');
const projectCacheDir = path.join(__dirname, 'node_modules', '.cache');

// Ensure cache directory exists with proper permissions
if (!fs.existsSync(projectCacheDir)) {
  fs.mkdirSync(projectCacheDir, { recursive: true, mode: 0o755 });
}

// Set TMPDIR environment variable to use project cache for Metro
// This will be picked up by Metro's file map cache
process.env.TMPDIR = projectCacheDir;

module.exports = config;

