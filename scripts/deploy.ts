import * as path from 'path';
import { runWranglerDeploy } from '@wesdizzle/app-kit/scripts';

const rootDir = process.cwd();

runWranglerDeploy({
  rootDir,
  appLabel: 'collection-tracker',
  faviconTargets: [
    path.join(rootDir, 'public', 'favicon.svg'),
    path.join(rootDir, 'dist', 'tracker', 'browser', 'favicon.svg'),
  ],
  secretsToUpload: [
    'SESSION_SECRET',
    'ADMIN_KEY',
    'ADMIN_EMAIL',
    'OIDC_ISSUER',
    'OIDC_CLIENT_ID',
    'TWITCH_CLIENT_ID',
    'TWITCH_CLIENT_SECRET',
    'EBAY_CLIENT_ID',
    'EBAY_CLIENT_SECRET',
    'MARKET_PRICING_ACCESS',
    'VAPID_PUBLIC_KEY',
    'VAPID_PRIVATE_KEY',
    'APP_NAME',
    'APP_SHORT_NAME',
    'APP_TAGLINE',
    'APP_AUTHOR',
    'APP_REPO_URL',
  ],
});
