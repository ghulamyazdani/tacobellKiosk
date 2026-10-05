import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// Path to package.json
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const packageJsonPath = path.join(__dirname, 'package.json');

// Read package.json
const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));

// Get version type argument (major, minor, patch)
const versionType = process.argv[2];

if (!versionType || !['major', 'minor', 'patch'].includes(versionType)) {
  console.error('Please specify a valid version type: major, minor, or patch');
  process.exit(1);
}

// Increment version based on the version type
const currentVersion = packageJson.version;
let [major, minor, patch] = currentVersion.split('.');
major = parseInt(major);
minor = parseInt(minor);
patch = parseInt(patch);

if (versionType === 'major') {
  major += 1;
  minor = 0;
  patch = 0;
} else if (versionType === 'minor') {
  minor += 1;
  patch = 0;
} else if (versionType === 'patch') {
  patch += 1;
}

const newVersion = `${major}.${minor}.${patch}`;
packageJson.version = newVersion;

// Write updated package.json
fs.writeFileSync(packageJsonPath, JSON.stringify(packageJson, null, 2));

console.log(`Updated version to ${packageJson.version}`);