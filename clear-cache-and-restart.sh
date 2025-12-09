#!/bin/bash
# Script to clear all caches and restart Expo with new logo

echo "🧹 Clearing all caches..."
echo ""

# Clear Expo cache
echo "1. Clearing .expo cache..."
rm -rf .expo

# Clear Metro bundler cache
echo "2. Clearing Metro bundler cache..."
rm -rf $TMPDIR/metro-* 2>/dev/null
rm -rf $TMPDIR/haste-* 2>/dev/null

# Clear watchman cache (if installed)
echo "3. Clearing Watchman cache..."
watchman watch-del-all 2>/dev/null || echo "   Watchman not installed, skipping..."

# Clear npm cache (optional)
echo "4. Verifying assets..."
ls -lh assets/*.png

echo ""
echo "✅ Cache cleared!"
echo ""
echo "📱 Now restart Expo with:"
echo "   npx expo start --clear"
echo ""
echo "Or for tunnel mode:"
echo "   npx expo start --tunnel --clear"
echo ""
echo "⚠️  IMPORTANT:"
echo "   - If using Expo Go, you may need to reload the app (shake device -> Reload)"
echo "   - For native builds, you MUST rebuild: npx expo prebuild --clean"
echo "   - The native splash screen requires a rebuild to update"






