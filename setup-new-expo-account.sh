#!/bin/bash
# Script to setup new Expo account for building

echo "🔧 Setting up new Expo account project..."
echo ""
echo "You'll be prompted to create a new project."
echo "When asked 'Would you like to create a project for @vijay97gopal/opine-interviewer?'"
echo "Answer: y (yes)"
echo ""

cd /var/www/Opine-Android

# Initialize EAS project (interactive)
npx eas-cli init

echo ""
echo "✅ Project initialized!"
echo ""
echo "Now you can build with:"
echo "npx eas-cli build --platform android --profile preview"











