#!/usr/bin/env node
/* eslint-disable @typescript-eslint/no-require-imports */

const fs = require('fs');
const path = require('path');

// note from Akhil: Add compromised versions to the below list for peace of mind. Script auto runs as 'pre-build' chore. Build fails and EXITS if compromised versions found!
const COMPROMISED_PACKAGES = {
  'backslash': ['0.2.1'],
  'chalk-template': ['1.1.1'],
  'supports-hyperlinks': ['4.1.1'],
  'has-ansi': ['6.0.1'],
  'simple-swizzle': ['0.2.3'],
  'color-string': ['2.1.1'],
  'error-ex': ['1.3.3'],
  'color-name': ['2.0.1'],
  'is-arrayish': ['0.3.3'],
  'slice-ansi': ['7.1.1'],
  'color-convert': ['3.1.1'],
  'wrap-ansi': ['9.0.1'],
  'ansi-regex': ['6.2.1'],
  'supports-color': ['10.2.1'],
  'strip-ansi': ['7.1.1'],
  'chalk': ['5.6.1'],
  'debug': ['4.4.2'],
  'ansi-styles': ['6.2.2']
};

function checkPackageJson() {
  const packageJsonPath = path.join(process.cwd(), 'package.json');
  
  if (!fs.existsSync(packageJsonPath)) {
    return false;
  }

  const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
  const allDeps = {
    ...packageJson.dependencies,
    ...packageJson.devDependencies,
    ...packageJson.peerDependencies,
    ...packageJson.optionalDependencies
  };

  for (const [packageName, compromisedVersions] of Object.entries(COMPROMISED_PACKAGES)) {
    if (allDeps[packageName]) {
      const installedVersion = allDeps[packageName];
      
      const isCompromised = compromisedVersions.some(badVersion => 
        installedVersion.includes(badVersion) || 
        installedVersion === badVersion ||
        (installedVersion.startsWith('^') && installedVersion.slice(1) === badVersion) ||
        (installedVersion.startsWith('~') && installedVersion.slice(1) === badVersion)
      );

      if (isCompromised) {
        console.error(`COMPROMISED PACKAGE: ${packageName}@${installedVersion}`);
        return true;
      }
    }
  }

  return false;
}

function checkPackageLock() {
  const lockPath = path.join(process.cwd(), 'package-lock.json');
  
  if (!fs.existsSync(lockPath)) {
    return false;
  }

  const lockFile = JSON.parse(fs.readFileSync(lockPath, 'utf8'));
  const allPackages = {
    ...lockFile.dependencies || {},
    ...lockFile.packages || {}
  };

  for (const [packagePath, packageInfo] of Object.entries(allPackages)) {
    if (!packageInfo.version) continue;

    const packageName = packagePath.startsWith('node_modules/') 
      ? packagePath.replace('node_modules/', '') 
      : packagePath;

    const baseName = packageName.split('/').pop();

    if (COMPROMISED_PACKAGES[baseName]) {
      const compromisedVersions = COMPROMISED_PACKAGES[baseName];
      const isCompromised = compromisedVersions.includes(packageInfo.version);

      if (isCompromised) {
        console.error(`COMPROMISED PACKAGE IN LOCK: ${baseName}@${packageInfo.version}`);
        return true;
      }
    }
  }

  return false;
}

function main() {
  const packageJsonCompromised = checkPackageJson();
  const lockFileCompromised = checkPackageLock();

  if (packageJsonCompromised || lockFileCompromised) {
    console.error('SECURITY ALERT: Compromised packages detected!');
    process.exit(1);
  }
  
  console.log('No compromised packages detected');
  process.exit(0);
}

if (require.main === module) {
  main();
}

module.exports = {
  checkPackageJson,
  checkPackageLock,
  COMPROMISED_PACKAGES
};